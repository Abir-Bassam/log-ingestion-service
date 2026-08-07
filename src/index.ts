/*import Fastify from "fastify";
import { config } from "./config/index.js";// بنستورد الاعدادات طبعا جافا لانه بدنا نترجمه 

const app = Fastify({ logger: false });// بننشا نسخة من السيرفر و ماي طبع سجل لكل طلب لانه رح يكون تحت ضغط و رح يقلل الاداء
// بدنا نعرف الاندبوينت ال4
app.get("/health", async (_req, reply) => {//بيستقبل طلبات من نوع جت و من مسار هيلث
    // _req معناها مش رح نستخدمه   
  return reply.code(200).send({ status: "ok" });
});

app.listen({ port: config.port, host: "0.0.0.0" })// بيشغل السيرفر على المنفذ من الاعدادات اللي عمناها 
// الهوست عشان ضروري داخل الدوكر عشان الحاوية تكون موصولة من برا
  .then(() => console.log(`listening on :${config.port}`));// طباعة رسالة تاكيد لما السيرفر يشتغل بنجاح
  */
 import Fastify from "fastify";
import { config } from "./config/index.js";
import { isDatabaseReady } from "./db/pool.js";

const app = Fastify({ logger: false });

// endpoint الصحّة: المولّد بيسأله قبل ما يبعت أي logs عشان يتأكد
// إنه الخدمة جاهزة فعلاً. لهيك ما بنكتفي بـ "السيرفر شغّال" —
// بنتأكد كمان إنه الاتصال بقاعدة البيانات ثابت.
app.get("/health", async (_req, reply) => {
  const dbReady = await isDatabaseReady();
  if (!dbReady) {
    // القاعدة لسا مش جاهزة → بنرجّع 503 (الخدمة غير متاحة مؤقتاً)
    // عشان المولّد يعرف إنه لازم يستنى مش يبلّش يبعت.
    return reply.code(503).send({ status: "database not ready" });
  }
  return reply.code(200).send({ status: "ok" });
});

app.listen({ port: config.port, host: "0.0.0.0" })
  .then(() => console.log(`listening on :${config.port}`));