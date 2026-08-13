interface Fetcher { fetch(input: Request | string, init?: RequestInit): Promise<Response>; }
type D1Database = Record<string, never>;
