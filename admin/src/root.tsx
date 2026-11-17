import { component$ } from "@builder.io/qwik";
import {
  QwikCityProvider,
  RouterOutlet,
  ServiceWorkerRegister,
} from "@builder.io/qwik-city";

import { themeInitScript } from "./lib/theme";

import "./global.css";

export default component$(() => {
  return (
    <QwikCityProvider>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Runs before <body> is parsed, so a stored theme never flashes. */}
        <script dangerouslySetInnerHTML={themeInitScript} />
        <link rel="manifest" href="/manifest.json" />
        <title>Gallery Admin</title>
      </head>
      <body>
        <RouterOutlet />
        <ServiceWorkerRegister />
      </body>
    </QwikCityProvider>
  );
});
