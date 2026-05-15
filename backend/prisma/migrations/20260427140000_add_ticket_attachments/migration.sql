-- Добавляем колонку attachments в ticket_messages.
-- Храним JSON-массив вложений строкой ([{url, mime, size, name?}]).
-- NULL/пустая строка означает "вложений нет".
ALTER TABLE "ticket_messages" ADD COLUMN "attachments" TEXT;
