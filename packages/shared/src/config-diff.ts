export interface ConfigDifference {
  path: string;
  left: unknown;
  right: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => valuesEqual(value, right[index]));
  }

  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key) => Object.hasOwn(right, key) && valuesEqual(left[key], right[key]));
  }

  return Object.is(left, right);
}

export function diffConfigs(left: unknown, right: unknown): ConfigDifference[] {
  const differences: ConfigDifference[] = [];

  function visit(leftValue: unknown, rightValue: unknown, path: string): void {
    if (valuesEqual(leftValue, rightValue)) {
      return;
    }

    if (isRecord(leftValue) && isRecord(rightValue)) {
      const keys = [...new Set([...Object.keys(leftValue), ...Object.keys(rightValue)])].sort();
      for (const key of keys) {
        const nextPath = path ? `${path}.${key}` : key;
        if (!Object.hasOwn(leftValue, key) || !Object.hasOwn(rightValue, key)) {
          differences.push({
            path: nextPath,
            left: leftValue[key],
            right: rightValue[key]
          });
        } else {
          visit(leftValue[key], rightValue[key], nextPath);
        }
      }
      return;
    }

    differences.push({ path, left: leftValue, right: rightValue });
  }

  visit(left, right, "");
  return differences;
}
