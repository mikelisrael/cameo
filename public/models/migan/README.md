---
library_name: onnx
pipeline_tag: image-to-image
tags:
  - inpainting
  - object-removal
license: mit
---
# MI-GAN (pipeline, v2)

## Model Description
MI-GAN is a small, fast image inpainting network designed for mobile devices. It was trained on Places2. This file is the ONNX pipeline build (`migan_pipeline_v2.onnx`): it crops around the hole, runs the network at 512 px inside, and pastes the result back, so any image size works.

- Source: https://huggingface.co/andraniksargsyan/migan
- Code: https://github.com/Picsart-AI-Research/MI-GAN (MIT; LICENSE-WEIGHTS is MIT too)
- Paper: Sargsyan et al., "MI-GAN: A Simple Baseline for Image Inpainting on Mobile Devices", ICCV 2023
- sha256: `6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b` (28,079,181 bytes)

## Input and output
| name | type | shape | notes |
| --- | --- | --- | --- |
| `image` (in) | uint8 | [b, 3, H, W] | planar RGB |
| `mask` (in) | uint8 | [b, 1, H, W] | 255 = keep, 0 = fill |
| `result` (out) | uint8 | [b, 3, H, W] | same H and W as the input |

## Licence
MIT, see LICENSE.
