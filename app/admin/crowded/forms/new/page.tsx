import { FormBuilder } from "../_components/form-builder";

export default function NewFormPage() {
  return (
    <div>
      <header className="mb-5">
        <h1 className="text-3xl font-semibold tracking-tight">
          Create a donation form
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure the form on the left. We'll create the Crowded collection
          and persist your branding when you save.
        </p>
      </header>
      <FormBuilder mode="create" />
    </div>
  );
}
