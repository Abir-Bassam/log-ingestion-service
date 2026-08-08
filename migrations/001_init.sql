-- ملف السكيم الأساسي. بينطبّق تلقائياً أول ما التطبيق يشتغل.
-- بصفحة المشاكل ع الدفتر:
-- ملاحظات التصميم (نفسها موجودة بال README):
--  * الجدول مقسّم بالتاريخ (يوم لكل partition). الحذف بيصير "أسقط
--    الـ partition القديم" — عملية فورية بدون قفل ولا bloat.
--  * الخصائص بعمود JSONB واحد: مرنة، بدون مضاعفة حجم الكتابة.
--  * الـ id من عدّاد عام، فـ (ts, id) بيعطي ترتيب كامل ثابت —
--    وهاد اللي بيخلّي الـ pagination ثابتة حتى لو الأوقات متطابقة.

-- امتداد بنحتاجه للبحث النصي الجزئي (فهرس trigram على message).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE logs (
    id         bigint GENERATED ALWAYS AS IDENTITY,  -- عدّاد عام فريد   طريقة جديدة في بوستجر بدل السيريال
    ts         timestamptz NOT NULL,                 -- وقت الحدث (مفتاح التقسيم)    عشان ما تتخربش الاوقات مع المناطق 
    level      text NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')), -- قيد بيفرض اي مستوى غير الاربعة على مستوى القاعدة نفسها يعني طبقة حماية اضافية
    service    text NOT NULL,
    message    text NOT NULL,
    attributes jsonb,                                -- الخصائص المرنة
    PRIMARY KEY (ts, id)   -- مفتاح التقسيم لازم يكون بالمفتاح الأساسي؛
                           -- وكمان هاد بالظبط فهرس الـ pagination.
) PARTITION BY RANGE (ts);  -- عشان اخلي القاعدة تقسم الجدول على حسب الوقت 

-- partition احتياطي لأي وقت خارج النافذة المُدارة (مثلاً سجل قديم جداً).
CREATE TABLE logs_default PARTITION OF logs DEFAULT;

-- هيك عملنا الجدول الاب اللوغ ديفولت بس الاجزاء اليومية الفعلية رح نعملها بعدين لانها رح تتولد تلقائيا لكل يوم 


-- فهارس أنماط البحث. بنعرّفها على الجدول الأب، فكل partition جديد
-- بيرثها تلقائياً.
CREATE INDEX logs_service_ts_idx ON logs (service, ts DESC);
CREATE INDEX logs_level_ts_idx   ON logs (level, ts DESC);

-- فهرس GIN للبحث بالخصائص. jsonb_path_ops أصغر وأسرع وبيدعم عملية
-- الاحتواء (@>) اللي بنحتاجها للبحث attr.<key>=<value>.
CREATE INDEX logs_attrs_idx ON logs USING gin (attributes jsonb_path_ops);

-- فهرس trigram عشان البحث النصي الجزئي (q) ما يتحوّل لمسح كامل للجدول.
-- هاد أغلى فهرس وقت الكتابة — منوثّق المقايضة بالـ README.
CREATE INDEX logs_message_trgm_idx ON logs USING gin (message gin_trgm_ops);