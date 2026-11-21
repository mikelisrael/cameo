# Security policy

## Supported versions

Only the latest version is supported. It is the one deployed at https://cameoapp.vercel.app from `main`.

## Reporting a vulnerability

Please report it privately, through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**, or go straight to https://github.com/mikelisrael/cameo/security/advisories/new.

Please include:

- what you found and why it matters
- the steps to reproduce it
- your browser, version and device

You can expect a first reply within a week. Please do not open a public issue until it is fixed.

## Scope

In scope:

- anything that could send a user's image, or data from it, off the device
- script injection in the app
- the service worker and the files it caches
- how the model and runtime files are supplied

Out of scope:

- bugs in the browser itself
- bugs in the upstream models
- anything that needs a compromised device

## How Cameo is built to be safe

Cameo is a static site. It has no backend, accounts, cookies or database. Images are processed on the device, in the browser, and are not uploaded.

The app makes these requests to other hosts:

- **Hugging Face** (`huggingface.co`): the model files for the cut-out, tap-to-select and upscaling. The request asks for a model file and carries no image data.
- **jsDelivr** (`cdn.jsdelivr.net`): the ONNX Runtime WebAssembly files. The request asks for a script and carries no image data.
- **Google Fonts** (`fonts.googleapis.com` and `fonts.gstatic.com`): the fonts. The request asks for font files and carries no image data.
- **GoatCounter**: an anonymous count of page views and cut-outs, sent as a page path and a `cutout` event. No image data, cookies, referrer or screen size are sent. It is skipped on localhost, on the `?bench` page and when Do Not Track or Global Privacy Control is on. In the current source the site code is empty, so nothing is sent until one is set.

The clean-up, face-finder and first rough cut-out models are served from Cameo's own site, not from another host.
