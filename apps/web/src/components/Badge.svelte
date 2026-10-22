<script lang="ts">
  let { label }: { label: string } = $props();
</script>

<span class="badge">{label}</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    border: 1px solid #dce5f4;
    border-radius: 999px;
    padding: 0.2rem 0.55rem;
    color: #516eab;
    background: #eef3ff;
    font-size: 0.7rem;
    line-height: 1.4;
  }
</style>
