import * as Y from "yjs";
import type { YSharedContainer } from "../core/yjs-types";

// Helper to access internal _item property safely
interface YTypeWithItem {
  _item?: {
    parentSub?: string | null;
  } | null;
  parent?: Y.AbstractType<unknown> | null;
}

type ParsedPattern = string[];

export class PathValidator {
  private patterns: ParsedPattern[];
  private root: YSharedContainer;

  constructor(root: YSharedContainer, patterns: string[]) {
    this.root = root;
    this.patterns = patterns.map((p) => p.split("."));
  }

  /**
   * Reconstructs the path from the root to the current property.
   *
   * @param container - The container where the operation is happening
   * @param key - The key or index of the operation
   * @returns Array of path segments, or null if path cannot be resolved relative to root
   */
  getPath(
    container: YSharedContainer,
    key: string | number,
  ): (string | number)[] | null {
    // 1. Start with the leaf key
    const path: (string | number)[] = [key];
    let curr: YTypeWithItem | null = container as YTypeWithItem;

    // 2. Traverse up to the root
    while (curr && curr !== this.root) {
      if (!curr.parent || !curr._item) {
        // Detached or reached top of doc without hitting our specific root
        return null;
      }

      const parent = curr.parent;

      if (parent instanceof Y.Map) {
        // Parent is a Map: parentSub is the key string
        const parentKey = curr._item.parentSub;
        if (typeof parentKey !== "string") return null;
        path.unshift(parentKey);
      } else if (parent instanceof Y.Array) {
        // Parent is an Array: This container is an item in that array.
        // Determining exact index in Yjs is O(N) and expensive.
        // We use a specific symbol/string to represent "An Array Item"
        // which will match against '*' in patterns.
        path.unshift("*");
      } else {
        // Unsupported parent type (Text, Xml)
        return null;
      }

      curr = parent as YTypeWithItem;
    }

    // 3. Verify we actually hit the configured root
    if (curr !== this.root) {
      return null;
    }

    return path;
  }

  /**
   * Checks if an operation should be synchronized based on ignore patterns.
   * @returns true if the operation should be synced, false if it should be ignored.
   */
  shouldSync(container: YSharedContainer, key: string | number): boolean {
    if (this.patterns.length === 0) return true;

    const path = this.getPath(container, key);

    // Safety: If we can't determine the path (e.g. detached), sync it to be safe
    // or log a warning. Here we default to true to avoid data loss.
    if (!path) return true;

    // Check if path matches any ignore pattern
    const isIgnored = this.patterns.some((pattern) => {
      if (pattern.length !== path.length) return false;

      return pattern.every((patternSegment, i) => {
        // 1. Wildcard matches anything
        if (patternSegment === "*") return true;

        // 2. Exact match
        const pathSegment = String(path[i]);
        if (patternSegment === pathSegment) return true;

        // 3. Array item handling:
        // If the path segment is our special array placeholder "*",
        // it assumes the pattern meant to target an array item here.
        // This makes "data.*.name" work.
        if (path[i] === "*") return true;

        return false;
      });
    });

    return !isIgnored;
  }
}
