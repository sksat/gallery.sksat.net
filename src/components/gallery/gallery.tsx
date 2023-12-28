import { component$, $, useResource$, Resource } from "@builder.io/qwik";

function image(src: string) {
  return (
    <img
      alt="gallery"
      class="block h-full w-full rounded-lg object-cover object-center"
      src={src} />
  );
}

export default component$(() => {
  const indexResource = useResource$(() => {
    return fetch('http://127.0.0.1:5173/media/media.json')
      .then(res => res.json())
      .then(data => data);
  });

  return (
    <div class="container mx-auto px-5 py-2 lg:px-32 lg:pt-12">
      <Resource
        value={indexResource}
        onResolved={(index) => {
          return <div class="-m-1 flex flex-wrap md:-m-2">
            {index.map(item => (
              <div class="flex w-1/3 flex-wrap">
                <div class="w-full p-1 md:p-2">{image(item.file)}</div>
              </div>
            ))}
          </div>;
        }}
      />
    </div>
  );
});
