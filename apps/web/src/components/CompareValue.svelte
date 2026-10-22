<script lang="ts">
  import Badge from "./Badge.svelte";

  let { path, value }: { path: string; value: unknown } = $props();

  const isEmpty = (input: unknown): boolean =>
    input === undefined
    || input === null
    || (typeof input === "string" && input.trim() === "");
  const logoUrl = $derived(
    typeof value === "string" && /(?:^|\.)logoUrl$/i.test(path) ? value : null
  );
  const colorValue = $derived(
    typeof value === "string" && /color/i.test(path) && /^#[\da-f]{6}$/i.test(value)
      ? value
      : null
  );
  const flatPrimitiveArray = $derived(
    Array.isArray(value)
    && value.length > 0
    && value.every((item) => item === null || typeof item !== "object")
      ? value
      : null
  );

  function displayJsonValue(input: unknown): string {
    if (input === undefined || input === null || input === "") return "Not configured";
    return String(input);
  }
</script>

{#if isEmpty(value)}
  <span class="not-configured">Not configured</span>
{:else if logoUrl}
  <img class="tenant-logo-preview" src={logoUrl} alt="Tenant logo" />
{:else if colorValue}
  <span class="color-value">
    <input type="color" value={colorValue} disabled aria-label={`Color value ${colorValue}`} />
    <code>{colorValue}</code>
  </span>
{:else if typeof value === "boolean"}
  <span class="boolean-value" class:success={value} class:danger={!value} aria-label={value ? "True" : "False"}>
    {value ? "✓" : "✗"}
  </span>
{:else if flatPrimitiveArray}
  <div class="primitive-array">
    {#each flatPrimitiveArray as item, index (`${index}-${displayJsonValue(item)}`)}
      <Badge label={displayJsonValue(item)} />
    {/each}
  </div>
{:else if typeof value === "object"}
  <pre class="json-value">{JSON.stringify(value, null, 2)}</pre>
{:else}
  {value}
{/if}

<style>
  .not-configured {
    color: #929eab;
    font-style: italic;
  }

  .tenant-logo-preview {
    display: block;
    width: 5rem;
    height: 5rem;
    border: 1px solid #e9edf2;
    border-radius: 0.5rem;
    object-fit: contain;
    background: white;
  }

  .color-value {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .primitive-array {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .color-value input {
    width: 2.25rem;
    height: 2.25rem;
    border: 1px solid #dfe5ec;
    border-radius: 0.3rem;
    padding: 0.15rem;
    background: white;
    opacity: 1;
  }

  .color-value input:disabled {
    cursor: default;
  }

  .color-value code {
    color: #59687b;
  }

  .success {
    color: #169b72;
  }

  .danger {
    color: #d3544a;
  }

  .boolean-value {
    font-size: 1rem;
    font-weight: 600;
  }

  .json-value {
    max-width: 100%;
    margin: 0;
    overflow: auto;
    color: #59687b;
    font-size: 0.7rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
