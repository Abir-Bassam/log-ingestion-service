# (two-stage build):
# بنترجم TypeScript
# و بالمرحلة الثانية بس النتائج عشان الصورة النهائية تكون صغيرة
# بمرحلة فيها كل
# أدوات التطوير، وبعدين ننقل بس الناتج المترجم لصورة نهائية خفيفة.
# هيك الصورة النهائية أصغر وأأمن (بدون أدوات مش لازمة بالتشغيل).

# المرحلة الأولى: البناء 
FROM node:22-alpine AS build
WORKDIR /app
# بننسخ ملفات المكتبات أول وبنثبّت هيك زّن 
#هالطبقة بالدوكر
# cache وما يعيد التثبيت إلا لو تغيّرت المكتبات.
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY tsconfig.build.json ./
COPY src ./src
RUN npm run build

#  المرحلة الثانية: التشغيل 
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
# --omit=dev: بنثبّت مكتبات التشغيل بس، بدون أدوات التطوير.
RUN npm ci --omit=dev
# بنجيب الكود المترجم من مرحلة البناء.
COPY --from=build /app/dist ./dist 

# بننسخ ملفات الـ migrations كمان، لأنه التطبيق بيقرأها عند الإقلاع.
COPY migrations ./migrations

# بنحدّد سقف للذاكرة أقل من حد الحاوية (256MB) عشان نتجنّب
# إنه النظام يقتل العملية فجأة عند امتلاء الذاكرة.
ENV NODE_OPTIONS=--max-old-space-size=192
EXPOSE 8080
CMD ["node", "dist/index.js"]