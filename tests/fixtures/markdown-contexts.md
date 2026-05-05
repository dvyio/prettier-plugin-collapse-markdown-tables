---
title: Markdown fixture
table: |
  | Front  | Matter |
  | ------ | ------ |
  | keep   | this   |
---

This paragraph is not a table | even with a pipe.
--- | not a delimiter
Still prose | not a row.

| Name  | Role        |
| ----- | ----------- |
| Davey | Builder     |
| Codex | Pair worker |

- Team
  | Name  | Role        |
  | ----- | ----------- |
  | Davey | Builder     |

> | Quote | Value |
> | ----- | ----- |
> | A     | B     |

> - Nested
>   | Name  | Role        |
>   | ----- | ----------- |
>   | Davey | Builder     |

<!-- prettier-ignore -->
| Wide  | Table       |
| ----- | ----------- |
| keep  | this        |

<!-- prettier-ignore-start -->
| Wide  | Table       |
| ----- | ----------- |
| keep  | this        |
<!-- prettier-ignore-end -->

```text
| Code  | Meaning |
| ----- | ------- |
| a     | b       |
```

    | Code  | Meaning |
    | ----- | ------- |
    | a     | b       |

<!--
| Comment | Meaning |
| ------- | ------- |
| a       | b       |
-->

<pre>
| Html  | Meaning |
| ----- | ------- |
| a     | b       |
</pre>

| Broken |
| --- | --- |
| no change |
