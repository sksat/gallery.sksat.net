import {
  FIELD_LABELS,
  LEVEL_LABELS,
  METADATA_LEVELS,
  type EditableField,
} from "~/lib/metadata";
import { field as fieldClass, label } from "./ui";

// One metadata field's site default level (/setting/), as a labelled
// <select> listing the levels from most to least. A photo's own level is
// a LevelSelect beside the field on its edit page.

export const MetadataSelect = ({
  field,
  name,
  value,
}: {
  field: EditableField;
  name: string;
  value: string;
}) => {
  const labels = LEVEL_LABELS[field] as Record<string, string>;
  const id = `mv-${name}`;
  return (
    <div>
      <label for={id} class={label}>
        {FIELD_LABELS[field]}
      </label>
      <select
        id={id}
        name={name}
        data-testid={`metadata-${field}`}
        class={fieldClass}
      >
        {(METADATA_LEVELS[field] as readonly string[]).map((level) => (
          <option key={level} value={level} selected={value === level}>
            {labels[level]}
          </option>
        ))}
      </select>
    </div>
  );
};
