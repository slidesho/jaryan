// در نسخه‌ی نمایشی (داخل مرورگر) این گره‌ها اجرا نمی‌شوند؛ فقط در نسخه‌ی نصبی کار می‌کنند.
const no = async () => { throw new Error("این گره در نسخه‌ی نمایشی کار نمی‌کند؛ نسخه‌ی نصبی را اجرا کنید"); };
export const serviceNodes = { smtp: no, sheetsRead: no, sheetsAppend: no, sheetsUpdate: no, postgres: no, mysql: no, llm: no };
export const code = no;
