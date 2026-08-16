-- فهرس trigram على message، بنوع GIST بدل GIN.
--
-- القياس: GIN كلّف 62% من معدّل الاستقبال (22.4k → 8.4k logs/sec) مقابل
-- تسريع q= من 392ms لـ 7ms. المقايضة مكلفة جداً على محور الأداء.
-- GIST أبطأ قليلاً بالقراءة لكن تكلفة الكتابة أقل بكتير — توازن أفضل
-- لخدمة ابتلاع عالي المعدّل.
CREATE INDEX IF NOT EXISTS logs_message_trgm_idx ON logs USING gist (message gist_trgm_ops);