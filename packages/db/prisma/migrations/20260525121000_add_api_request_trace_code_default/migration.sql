ALTER TABLE "ApiRequest"
ALTER COLUMN "traceCode" SET DEFAULT ('REQ-DB-' || upper(substr(md5(((random())::text || (clock_timestamp())::text)), 1, 16)));
