---
table: |
  | Front  | Matter |
  | ------ | ------ |
  | keep   | this   |
literal: |
  ---
  | Still | Front matter |
  | ----- | ------------ |
  | keep  | this         |
...

```markdown
| Code  | Meaning |
| ----- | ------- |
| a     | b       |
```

```markdown
<!-- prettier-ignore-start -->
| Code  | Meaning |
| ----- | ------- |
| keep  | this    |
```

    | Code  | Meaning |
    | ----- | ------- |
    | a     | b       |

    > | Code  | Meaning |
    > | ----- | ------- |
    > | a     | b       |

 	| Code  | Meaning |
 	| ----- | ------- |
 	| a     | b       |

<!--
| Comment | Meaning |
| ------- | ------- |
| a       | b       |
-->

<!--
| Comment | Meaning |
| ------- | ------- |
| a       | b       |
comment closes here --> trailing text

<script>
const value = `
| Script | Meaning |
| ------ | ------- |
| a      | b       |
`;
</script>

<style>
/* | Style | Meaning | */
</style>

<pre>
| Html  | Meaning |
| ----- | ------- |
| a     | b       |
</pre>

<section data-kind="fixture" data-rule="score > 10">
| Html  | Meaning |
| ----- | ------- |
| a     | b       |
</section>

</section>
| Html  | Meaning |
| ----- | ------- |
| a     | b       |

<my-widget data-kind="fixture">
| Html  | Meaning |
| ----- | ------- |
| a     | b       |
</my-widget>

<my-widget data-rule="score > 10" data-template="<role-card />">
| Html  | Meaning |
| ----- | ------- |
| a     | b       |
</my-widget>

<my-widget data-kind="empty">

This line is outside the custom HTML block.

<!-- prettier-ignore -->
| Wide  | Table       |
| ----- | ----------- |
| keep  | this        |

<!-- prettier-ignore -->
- Item
  | Wide  | Table       |
  | ----- | ----------- |
  | keep  | this        |

<!-- prettier-ignore-start -->
| Wide  | Table       |
| ----- | ----------- |
| keep  | this        |
<!-- prettier-ignore-end -->
