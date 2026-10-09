# Third-party notices

Averages.io redistributes the following third-party material. Each is used under
its own license, reproduced below as those licenses require.

---

## NSFW detection model weights

**Files:** `public/models/mobilenet_v2/model.json`,
`public/models/mobilenet_v2/group1-shard1of1`

These are the pre-trained MobileNetV2 weights published by the NSFWJS project,
served from this repository rather than a CDN (NSFWJS's own README recommends
self-hosting, since their hosted copy has been moved in the past). The weights
are redistributed unmodified.

- **Source:** https://github.com/infinitered/nsfwjs (`models/mobilenet_v2/`)
- **Upstream model:** https://github.com/GantMan/nsfw_model
- **License:** MIT

```
MIT License

Copyright (c) 2019 Infinite Red, Inc.
Copyright (c) 2020 The nsfw_model Developers

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## Twemoji graphics

The emoji icons in the app (for example on course pages, Materials and
Messages) are Twemoji graphics, embedded as inline SVG in `pages-src/`.

Copyright 2019 Twitter, Inc and other contributors.
Copyright 2024 Twemoji contributors (https://github.com/jdecked/twemoji).
Licensed under CC-BY 4.0: https://creativecommons.org/licenses/by/4.0/

---

## Fredoka font

**File:** `public/fonts/fredoka-700.woff2`

Fredoka Bold (Latin subset), used for the labels on the file type icons
(`public/js/averages-file-icons.js`). Redistributed unmodified, from the
Fontsource package of the Google Fonts release.

- **Source:** https://github.com/hafontia/Fredoka-One, via https://fontsource.org/fonts/fredoka
- **License:** SIL Open Font License 1.1

```
Copyright 2016 The Fredoka Project Authors (https://github.com/hafontia/Fredoka-One)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

---

## Runtime dependencies

These are installed from npm at build time rather than committed here, so their
license texts ship inside `node_modules/`. Listed for reference:

| Package | License |
|---|---|
| `next` | MIT |
| `react`, `react-dom` | MIT |
| `nsfwjs` | MIT |
| `@tensorflow/tfjs` | Apache-2.0 |

---

## Not covered by this project's license

The Averages.io name, logo and visual identity are not licensed for
reuse. See the LICENSE file for what the code itself permits.

Averages.io is an independent project and is not affiliated with, endorsed by,
or sponsored by PowerSchool. Schoology and PowerSchool are trademarks of
PowerSchool Holdings, Inc.
