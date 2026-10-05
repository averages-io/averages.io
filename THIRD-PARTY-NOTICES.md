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
