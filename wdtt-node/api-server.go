package main

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

type Database struct {
	MainPassword string                    `json:"main_password"`
	AdminID      string                    `json:"admin_id"`
	BotToken     string                    `json:"bot_token"`
	Passwords    map[string]*PasswordEntry `json:"passwords"`
	Devices      map[string]*ClientDevice  `json:"devices"`
}

type PasswordEntry struct {
	DeviceID      string `json:"device_id"`
	ExpiresAt     int64  `json:"expires_at"`
	DownBytes     int64  `json:"down_bytes"`
	UpBytes       int64  `json:"up_bytes"`
	VkHash        string `json:"vk_hash,omitempty"`
	Ports         string `json:"ports,omitempty"`
	IsDeactivated bool   `json:"is_deactivated,omitempty"`
}

type ClientDevice struct {
	DeviceID string `json:"device_id"`
	IP       string `json:"ip"`
	PrivKey  string `json:"priv_key"`
	PubKey   string `json:"pub_key"`
}

var (
	db       *Database
	dbMutex  sync.Mutex
	dbFile   string
	serverIP string
	wdttPorts string
	defaultVkHash string
)

const (
	passChars            = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
	generatedPasswordLen = 16
)

func generatePassword() string {
	b := make([]byte, generatedPasswordLen)
	randomBytes := make([]byte, len(b))
	if _, err := rand.Read(randomBytes); err != nil {
		now := time.Now().UnixNano()
		for i := range b {
			b[i] = passChars[int(now+int64(i))%len(passChars)]
		}
		return string(b)
	}
	for i, raw := range randomBytes {
		b[i] = passChars[int(raw)%len(passChars)]
	}
	return string(b)
}

func loadDB() {
	data, err := os.ReadFile(dbFile)
	if err != nil {
		db = &Database{
			Passwords: make(map[string]*PasswordEntry),
			Devices:   make(map[string]*ClientDevice),
		}
		return
	}
	db = &Database{
		Passwords: make(map[string]*PasswordEntry),
		Devices:   make(map[string]*ClientDevice),
	}
	json.Unmarshal(data, db)
	if db.Passwords == nil {
		db.Passwords = make(map[string]*PasswordEntry)
	}
	if db.Devices == nil {
		db.Devices = make(map[string]*ClientDevice)
	}
}

func saveDB() {
	data, _ := json.MarshalIndent(db, "", "  ")
	os.WriteFile(dbFile, data, 0600)
}

// Restart the WDTT server process so it picks up new passwords from passwords.json
func restartWdttServer() {
	log.Println("[API] Restarting WDTT server to pick up new password...")
	// pkill from procps package
	exec.Command("pkill", "-SIGTERM", "wdtt-server").Run()
	// The watchdog in start.sh will restart it
}

func getPublicIP() string {
	if serverIP != "" {
		return serverIP
	}
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get("https://api.ipify.org")
	if err != nil {
		return "YOUR_SERVER_IP"
	}
	defer resp.Body.Close()
	ipBytes, _ := io.ReadAll(resp.Body)
	serverIP = strings.TrimSpace(string(ipBytes))
	return serverIP
}

func buildWdttLink(password, vkHash string) string {
	parts := strings.Split(wdttPorts, ",")
	dtlsPort := "56000"
	wgPort := "56001"
	tunPort := "9000"
	if len(parts) >= 3 {
		dtlsPort = strings.TrimSpace(parts[0])
		wgPort = strings.TrimSpace(parts[1])
		tunPort = strings.TrimSpace(parts[2])
	}
	if vkHash == "" {
		vkHash = defaultVkHash
	}
	return fmt.Sprintf("wdtt://%s:%s:%s:%s:%s:%s", getPublicIP(), dtlsPort, wgPort, tunPort, password, vkHash)
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-API-Key")
		if r.Method == "OPTIONS" {
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		apiKey := r.Header.Get("X-API-Key")
		expectedKey := os.Getenv("API_KEY")
		if expectedKey != "" && apiKey != expectedKey {
			http.Error(w, `{"error":"unauthorized"}`, 401)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// POST /api/keys - Create a new key
func handleCreateKey(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, `{"error":"method not allowed"}`, 405)
		return
	}

	var req struct {
		Password          string `json:"password"`
		TrafficLimitBytes string `json:"traffic_limit_bytes"`
		VkHash            string `json:"vk_hash"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	dbMutex.Lock()
	defer dbMutex.Unlock()

	loadDB()

	// Generate password if not provided
	password := req.Password
	if password == "" {
		for i := 0; i < 10; i++ {
			candidate := generatePassword()
			if _, exists := db.Passwords[candidate]; !exists {
				password = candidate
				break
			}
		}
		if password == "" {
			http.Error(w, `{"error":"failed to generate unique password"}`, 500)
			return
		}
	}

	// Check if password already exists
	if _, exists := db.Passwords[password]; exists {
		// Password exists — return its info (idempotent)
		entry := db.Passwords[password]
		vkHash := entry.VkHash
		if vkHash == "" {
			vkHash = defaultVkHash
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"password":  password,
			"vk_hash":   vkHash,
			"wdtt_link": buildWdttLink(password, vkHash),
			"expires_at": time.Unix(entry.ExpiresAt, 0).Format(time.RFC3339),
		})
		return
	}

	// Use provided VK hash or default
	vkHash := req.VkHash
	if vkHash == "" {
		vkHash = defaultVkHash
	}
	ports := wdttPorts

	// Create password entry (expires in 30 days by default)
	expiresAt := time.Now().Add(30 * 24 * time.Hour).Unix()
	db.Passwords[password] = &PasswordEntry{
		ExpiresAt: expiresAt,
		VkHash:    vkHash,
		Ports:     ports,
	}
	saveDB()

	wdttLink := buildWdttLink(password, vkHash)

	log.Printf("[API] Created key: %s (vk_hash: %s, expires: %s)", password, vkHash[:min(8, len(vkHash))], time.Unix(expiresAt, 0).Format("2006-01-02"))

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(map[string]string{
		"password":  password,
		"vk_hash":   vkHash,
		"wdtt_link": wdttLink,
		"expires_at": time.Unix(expiresAt, 0).Format(time.RFC3339),
	})
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// DELETE /api/keys/:password - Revoke a key
func handleDeleteKey(w http.ResponseWriter, r *http.Request) {
	if r.Method != "DELETE" {
		http.Error(w, `{"error":"method not allowed"}`, 405)
		return
	}

	password := strings.TrimPrefix(r.URL.Path, "/api/keys/")
	if password == "" {
		http.Error(w, `{"error":"password required"}`, 400)
		return
	}

	dbMutex.Lock()
	defer dbMutex.Unlock()

	loadDB()

	if _, exists := db.Passwords[password]; !exists {
		http.Error(w, `{"error":"password not found"}`, 404)
		return
	}

	delete(db.Passwords, password)
	saveDB()

	log.Printf("[API] Revoked key: %s", password)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "revoked"})
}

// GET /api/health - Health check
func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "ok",
		"version": "1.0.0-stealthnet",
		"uptime":  time.Since(startTime).Seconds(),
	})
}

// GET /api/keys - List all keys
func handleListKeys(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" {
		http.Error(w, `{"error":"method not allowed"}`, 405)
		return
	}

	dbMutex.Lock()
	defer dbMutex.Unlock()

	loadDB()

	keys := make([]map[string]interface{}, 0)
	for password, entry := range db.Passwords {
		isExpired := entry.ExpiresAt > 0 && time.Now().Unix() > entry.ExpiresAt
		vkHash := entry.VkHash
		if vkHash == "" {
			vkHash = defaultVkHash
		}
		keys = append(keys, map[string]interface{}{
			"password":       password,
			"vk_hash":        vkHash,
			"expires_at":     time.Unix(entry.ExpiresAt, 0).Format(time.RFC3339),
			"is_expired":     isExpired,
			"is_deactivated": entry.IsDeactivated,
			"device_id":      entry.DeviceID,
			"down_bytes":     entry.DownBytes,
			"up_bytes":       entry.UpBytes,
			"wdtt_link":      buildWdttLink(password, vkHash),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"items": keys})
}

var startTime = time.Now()

func main() {
	log.SetFlags(log.Ldate | log.Ltime | log.Lmicroseconds)
	log.Println("══════════════════════════════════════════")
	log.Println("   WDTT API Wrapper for STEALTHNET")
	log.Println("══════════════════════════════════════════")

	configDir := os.Getenv("CONFIG_DIR")
	if configDir == "" {
		configDir = "/etc/wdtt"
	}
	dbFile = filepath.Join(configDir, "passwords.json")

	wdttPorts = os.Getenv("WDTT_PORTS")
	if wdttPorts == "" {
		wdttPorts = "56000,56001,9000"
	}

	serverIP = os.Getenv("PUBLIC_HOST")
	defaultVkHash = os.Getenv("VK_HASH")

	loadDB()
	log.Printf("[API] Loaded %d passwords from %s", len(db.Passwords), dbFile)
	if defaultVkHash != "" {
		log.Printf("[API] Default VK hash: %s...", defaultVkHash[:min(12, len(defaultVkHash))])
	} else {
		log.Printf("[API] WARNING: No VK_HASH set. wdtt:// links may not work without VK hash.")
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/keys", handleCreateKey)
	mux.HandleFunc("/api/keys/", handleDeleteKey)
	mux.HandleFunc("/api/health", handleHealth)
	mux.HandleFunc("/api/keys/list", handleListKeys)

	handler := corsMiddleware(authMiddleware(mux))

	port := os.Getenv("API_PORT")
	if port == "" {
		port = "9000"
	}

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		<-sig
		log.Println("[API] Shutting down...")
		os.Exit(0)
	}()

	log.Printf("[API] Listening on :%s", port)
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatalf("[API] Server error: %v", err)
	}
}
