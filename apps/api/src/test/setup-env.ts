
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://prospect:prospect@localhost:5433/prospect_poc_test?schema=public";
process.env.JWT_SECRET ??= "test-access-secret-0123456789abcdef0123456789abcdef";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-fedcba9876543210fedcba9876543210";
process.env.WEB_URL ??= "http://localhost:3000";
process.env.AI_PROVIDER ??= "mock";
