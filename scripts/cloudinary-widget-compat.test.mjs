import { test } from "node:test";
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import React, { act } from "react";
import TestRenderer from "react-test-renderer";

// Exercise the real Next Cloudinary widget and our actual upload components,
// while substituting its script loader and the remote Cloudinary SDK. These
// tests do not verify the provider's unsigned-preset restrictions.
const toastErrors = [];
const require = createRequire(import.meta.url);
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "next/script") {
    return {
      __esModule: true,
      default: (props) => React.createElement("mock-cloudinary-script", props),
    };
  }
  if (request === "next/image") {
    return {
      __esModule: true,
      default: ({ src, alt }) => React.createElement("img", { src, alt }),
    };
  }
  if (request === "sonner") {
    return { toast: { error: (message) => toastErrors.push(message) } };
  }
  return originalLoad.call(this, request, parent, isMain);
};
let ImageUploadGrid;
let MessageInput;
try {
  ({ ImageUploadGrid } = require("../src/components/marketplace/image-upload-grid.tsx"));
  ({ MessageInput } = require("../src/components/messaging/message-input.tsx"));
} finally {
  Module._load = originalLoad;
}

const imageUrl = "https://res.cloudinary.com/test-cloud/image/upload/photo.jpg";
const success = { event: "success", info: { secure_url: imageUrl, public_id: "photo" } };

function setup(t) {
  const saved = {
    cloud: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
    preset: process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET,
    window: globalThis.window,
    idle: globalThis.requestIdleCallback,
    actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT,
    react: globalThis.React,
  };
  process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME = "test-cloud";
  process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET = "test-preset";
  // tsx's test-time JSX transform is classic; Next uses the automatic runtime.
  globalThis.React = React;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  toastErrors.length = 0;

  let widget;
  let opened = 0;
  let destroyed = 0;
  globalThis.window = {
    cloudinary: {
      createUploadWidget(options, callback) {
        widget = { options, callback };
        return {
          open: () => { opened += 1; },
          destroy: () => { destroyed += 1; },
        };
      },
    },
    requestIdleCallback: (callback) => callback(),
  };
  globalThis.requestIdleCallback = globalThis.window.requestIdleCallback;

  let view;
  t.after(async () => {
    if (view) await act(async () => view.unmount());
    for (const [key, value] of Object.entries({
      NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: saved.cloud,
      NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET: saved.preset,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (saved.window === undefined) delete globalThis.window;
    else globalThis.window = saved.window;
    if (saved.idle === undefined) delete globalThis.requestIdleCallback;
    else globalThis.requestIdleCallback = saved.idle;
    if (saved.actEnvironment === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    else globalThis.IS_REACT_ACT_ENVIRONMENT = saved.actEnvironment;
    if (saved.react === undefined) delete globalThis.React;
    else globalThis.React = saved.react;
  });

  return {
    async render(element) {
      await act(async () => { view = TestRenderer.create(element); });
      await act(async () => view.root.findByType("mock-cloudinary-script").props.onLoad());
      assert.ok(widget, "the upload widget should be created after its script loads");
      return view;
    },
    async unmount() {
      await act(async () => view.unmount());
      view = undefined;
      assert.equal(destroyed, 1);
    },
    get widget() { return widget; },
    get opened() { return opened; },
  };
}

test("listing upload opens the widget and receives successful images and errors", async (t) => {
  const harness = setup(t);
  const changes = [];
  const view = await harness.render(React.createElement(ImageUploadGrid, {
    images: [],
    onChange: (images) => changes.push(images),
  }));

  assert.deepEqual(harness.widget.options, {
    cloudName: "test-cloud", apiKey: undefined, uploadPreset: "test-preset",
    maxFiles: 8, sources: ["local", "camera"], multiple: true,
  });
  await act(async () => view.root.findByType("button").props.onClick());
  assert.equal(harness.opened, 1);
  await act(async () => harness.widget.callback(null, success));
  assert.deepEqual(changes, [[{ url: imageUrl, cloudinaryId: "photo" }]]);
  await act(async () => harness.widget.callback({ message: "simulated failure" }));
  assert.deepEqual(toastErrors, ["Upload failed — please try again."]);
  await harness.unmount();
});

test("chat upload opens the widget, attaches an image, and sends it", async (t) => {
  const harness = setup(t);
  const messages = [];
  const view = await harness.render(React.createElement(MessageInput, {
    onSend: async (message) => { messages.push(message); },
    onTyping: () => {},
  }));

  assert.deepEqual(harness.widget.options, {
    cloudName: "test-cloud", apiKey: undefined, uploadPreset: "test-preset",
    maxFiles: 1, sources: ["local", "camera"],
  });
  const button = (label) => view.root.findAllByType("button").find((node) => node.props["aria-label"] === label);
  await act(async () => button("Attach image").props.onClick());
  assert.equal(harness.opened, 1);
  await act(async () => harness.widget.callback(null, success));
  assert.equal(view.root.findByType("img").props.src, imageUrl);
  await act(async () => button("Send message").props.onClick());
  assert.deepEqual(messages, [{ content: undefined, imageUrl }]);
  await act(async () => harness.widget.callback({ message: "simulated failure" }));
  assert.deepEqual(toastErrors, ["Image upload failed."]);
  await harness.unmount();
});
