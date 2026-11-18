import {
  FIELD_LABELS,
  LEVEL_LABELS,
  METADATA_LEVELS,
  type EditableField,
} from "~/lib/metadata";
import { field as fieldClass, label } from "./ui";

// One metadata field's level, as a labelled <select> listing the levels
// from most to least. On a photo, the first option follows the site
// default and says which it is (既定（…）); on the settings page there is
// no such option.

export const MetadataSelect = ({
  field,
  name,
  value,
  siteDefault,
}: {
  field: EditableField;
  name: string;
  /** The chosen level; "" = the site default. */
  value: string;
  /** The site's level for this field; omit on the settings page. */
  siteDefault?: string;
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
        {siteDefault !== undefined && (
          <option value="" selected={value === ""}>
            {`既定（${labels[siteDefault]}）`}
          </option>
        )}
        {(METADATA_LEVELS[field] as readonly string[]).map((level) => (
          <option key={level} value={level} selected={value === level}>
            {labels[level]}
          </option>
        ))}
      </select>
    </div>
  );
};
