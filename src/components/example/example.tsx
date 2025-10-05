import { component$, useSignal } from "@builder.io/qwik";

interface ExampleProps {
  title: string;
}

export const Example = component$<ExampleProps>((props) => {
  const count = useSignal(0);

  return (
    <div>
      <h1>{props.title}</h1>
      <p>Count: {count.value}</p>
      <button onClick$={() => count.value++}>Increment</button>
    </div>
  );
});
