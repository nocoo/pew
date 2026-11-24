# Bundled font assets

These unchanged Latin WOFF2 assets preserve the existing Inter, Space Grotesk and Caveat typography. `next/font/local` avoids the Next 16.3.6 Turbopack Google-font resolver failure during builds. No Fontsource runtime dependency is installed. Inter uses weights 100–900, Space Grotesk 400–700 and Caveat 700; each variable file contains the upstream weight axis, with only the existing weights declared by the app.

Source: Fontsource variable packages version **5.3.0**, retrieved on 2026-10-03 from the permitted Tencent npm mirror. Each archive's SHA-512 was verified against its registry metadata before copying only `files/*-latin-wght-normal.woff2` and its OFL license. Assets are unmodified and retain their original names. The adjacent `*.LICENSE` files contain the respective copyright and SIL Open Font License notices.

| Package                              | Archive                                                                                        | SHA-512 integrity                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `@fontsource-variable/inter`         | `https://mirrors.tencent.com/npm/@fontsource-variable/inter/-/inter-5.3.0.tgz`                 | `sha512-OupL48va4JNofb97w6NYeF9S7W/kHNKM0Er8Dem5nqi4jeOLrVJDoE8tZEpnMJmtkvNbB1EIPPwHcdkF6b1oUA==` |
| `@fontsource-variable/space-grotesk` | `https://mirrors.tencent.com/npm/@fontsource-variable/space-grotesk/-/space-grotesk-5.3.0.tgz` | `sha512-2IxmvfB08i9vnGB3Ym/AXvhRE+8XOjWMXIyDum03c+tPwH0FUoMNQfGpU8NXPxjbws0Vvss3AH0Zqt4oJBBAdw==` |
| `@fontsource-variable/caveat`        | `https://mirrors.tencent.com/npm/@fontsource-variable/caveat/-/caveat-5.3.0.tgz`               | `sha512-Q3mjghoYIlXgwqBPJKZ4q6f3zu921Gq7UU76r9Z+NAmhapHfX130GIFpOCYf8vt2SIcgCi9RHDT7anfJKg/kiA==` |
