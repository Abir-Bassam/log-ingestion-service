-- مفاتيح API للميزة الاختيارية (المصادقة).
-- بنخزّن hash المفتاح، أبداً مش المفتاح الخام — لو تسرّبت القاعدة
-- ما حدا بيقدر يستخرج المفاتيح.
CREATE TABLE api_keys (
    key_hash   text PRIMARY KEY,
    scopes     text[] NOT NULL DEFAULT '{ingest,query}',
    created_at timestamptz NOT NULL DEFAULT now()
);