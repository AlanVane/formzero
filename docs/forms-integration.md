# 在外部工程中集成 FormZero 表单

本文面向「在另一个工程/站点里使用 FormZero 收集提交」的场景。目标工程有自己的设计系统，不要照抄本项目前端的样式。

## 1. 前提：本项目里没有可直接复用的表单组件

FormZero 仓库里不存在一个「活的」联系表单组件。审核 `app/routes/forms.$formId.integration.tsx` 可以看到：

- `htmlExample`、`jsExample`、`reactExample` 三个常量只是**示例字符串**；
- 它们唯一的用途是交给 `Highlight` 做语法高亮（`code={...}`），以及通过「复制」按钮写入剪贴板（`handleCopyCode`）；
- 应用内真正的 `<form>` 全部属于后台自身（新建表单、通知设置、表单设置、初始化流程），没有一个提交到 `/api/forms/:id/submissions`。

所以集成方式是：把表结构复制进目标工程，替换 `action`，用目标工程自己的样式重写外观。后台不需要为此新增任何东西。

## 2. 先拿到 endpoint

每个表单有独立 endpoint，格式固定：

```
https://<你的 Worker 域名>/api/forms/<formId>/submissions
```

在 FormZero 后台对应表单的 **Integration** 标签页可以直接复制该地址。

## 3. 最小可用结构

去掉本项目示例里的 `<style>` 后，结构如下。这是接入时真正需要保留的部分：

```html
<form
  action="https://YOUR-WORKER/api/forms/YOUR-FORM-ID/submissions"
  method="POST"
>
  <input type="text" name="name" placeholder="Your Name" required />
  <input type="text" name="company" placeholder="Your Company" />
  <input type="email" name="email" placeholder="Your Email" required />

  <fieldset>
    <legend>Project Type</legend>
    <label
      ><input type="checkbox" name="projectType" value="AI agent" /> AI
      agent</label
    >
    <label
      ><input type="checkbox" name="projectType" value="Automation" />
      Automation</label
    >
    <label
      ><input type="checkbox" name="projectType" value="Web app" /> Web
      app</label
    >
    <label
      ><input type="checkbox" name="projectType" value="Mobile app" /> Mobile
      app</label
    >
    <label
      ><input type="checkbox" name="projectType" value="Not sure yet" /> Not
      sure yet</label
    >
  </fieldset>

  <textarea name="message" placeholder="Your Message"></textarea>
  <button type="submit">Submit</button>
</form>
```

要点：

- `method="POST"` 必须有。默认编码 `application/x-www-form-urlencoded` 即可，接口也接受 `multipart/form-data`。
- `name` 属性决定存下来的字段名，也是后台列名和邮件字段名的来源，不要随意改动。
- 多选组内每个选项使用**相同的 `name`** 和**不同的 `value`**，不需要 JavaScript。
- 非必填项留空即可；`required` 由目标工程自行决定。

## 4. 多选支持的前提（重要）

多选依赖服务端把重复键收集成数组。在本次改动之前，接口用 `Object.fromEntries(formData)` 解析表单，同名多值会被**静默截断为最后一个值**，没有任何报错。

因此：

- 部署的 FormZero 必须包含这次后端改动；
- 若目标接的是较旧版本的实例，勾选多个项目只会存下最后一项；
- 这也意味着旧实例上任何使用同名多值（例如 checkbox 组）的表单一直在丢数据。

改动后的服务端行为（`app/routes/api.forms.$formId.submissions.tsx`）：

| 提交内容                                     | 存储结果                                   |
| -------------------------------------------- | ------------------------------------------ |
| `name=Ann`                                   | `"name": "Ann"`（标量，向后兼容）          |
| `projectType=Web app&projectType=Mobile app` | `"projectType": ["Web app", "Mobile app"]` |

## 5. 数据形态与展示

- HTML 表单与 JSON 提交的最终形态一致：多选是**数组**，单选/单值是**字符串**。
- 后台提交列表：数组字段以 `, ` 连接显示。
- CSV 导出：数组字段同样以 `, ` 连接。
- 邮件通知：数组渲染为项目符号列表。
- 历史数据中该字段可能仍是字符串，展示层两种都能处理。

字段显示名由 `app/lib/field-labels.ts` 中的映射决定，目前只有 `projectType → Project Type`；未登记的字段按各自视图的默认规则显示。

## 6. 样式接入

**不要照抄示例里的 `<style>` 块。** 它有三个问题：

1. 硬编码了 slate 色值（`rgba(15, 23, 42, 0.2)`、`#0f172a` 等），与目标工程的设计令牌无关；
2. 使用 `.project-type` 这类通用类名，容易与目标工程已有 CSS 冲突；
3. 自带的一套间距/圆角会覆盖目标工程的排版节奏。

正确做法是保留语义结构，用目标工程的类名和令牌重写外观。若要实现「药丸按钮」观感，模式是固定的：

```css
/* 视觉上像按钮，行为仍是原生 checkbox */
.project-type label {
  position: relative;
  cursor: pointer;
}
.project-type input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.project-type span {
  /* 用你自己的令牌：内边距、圆角、边框、背景 */
}

.project-type label:hover span {
  /* 悬停态 */
}
.project-type input:checked + span {
  /* 选中态：更强的边框/底色与对比度 */
}
.project-type input:focus-visible + span {
  /* 键盘焦点环 */
}
```

关键约束：

- **不要用 `display: none` 隐藏输入框**，否则键盘无法聚焦、无法用空格勾选。
- 焦点环必须保留，它是键盘用户唯一的状态提示。
- 选项容器用 `display: flex; flex-wrap: wrap; gap: …`，窄屏时自然换行。

## 7. 提交后的行为

HTML 表单提交（非 JSON 请求）成功后返回 `303` 重定向，按优先级：

1. URL 上的 `?redirect=` 参数；
2. 请求的 `Referer` 头；
3. 兜底 `/success`。

因此默认会回到发起提交的页面。需要固定跳转到感谢页时，把 `redirect` 拼到 `action` 上：

```html
<form
  action="https://YOUR-WORKER/api/forms/YOUR-FORM-ID/submissions?redirect=https%3A%2F%2Fyoursite.com%2Fthanks"
  method="POST"
></form>
```

`redirect` 的值必须做 URL 编码；接口不校验该参数，因此不要在服务端拼接用户可控的内容。

### 7.1 关于感谢页

本工程自带两个兜底页面：

- `app/routes/success.tsx` —— 绿色勾选图标 + "Submission Successful!"
- `app/routes/error.tsx` —— 按 `?error=` 区分的三种错误页

`success.tsx` 本身就是一份**可直接复制的模板**：组件体只有 JSX 和 Tailwind 类名，没有状态、没有 `components/ui/*` 依赖，唯一一行 `import` 是 `meta` 用的类型。复制到目标工程、改文案、把 `gray-*` / `green-*` 换成语义化令牌即可。

`error.tsx` 同理，只是它多一个 `loader` 从 `?error=` 取文案；那部分属于服务端逻辑，复制时按目标工程的路由方式重写。

但不要指望它们「已经在那儿、会自动生效」：

1. 它们渲染在 FormZero 的域名下，带的是本项目的样式与文案，与目标站点的品牌不一致；
2. 更重要的一点——**它们通常不会被用到**。浏览器跨站提交表单默认带 `Referer`，所以默认行为是把用户送回你发起提交的那个页面，而不是 `/success`。用户看到的是自己刚填的空表单，没有任何成功提示，很可能重复提交。

所以实际要做的两步是：把 `success.tsx` 的 JSX 复制进目标工程，再用 `?redirect=` 指过去。

```html
<form
  action="https://YOUR-WORKER/api/forms/YOUR-FORM-ID/submissions?redirect=https%3A%2F%2Fyoursite.com%2Fthanks"
  method="POST"
>
  <!-- … 表单字段 … -->
</form>
```

`redirect` 必须是**绝对地址**。相对路径会相对接口所在的 Worker 域名解析，而不是相对你的站点——写成 `%2Fthanks` 会把用户送到 `https://YOUR-WORKER/thanks`（通常是 404）。

只有一个简单的成功/失败文案需求时，用 JSON 分支更省事（见第 8 节）：`fetch` 拿到 `201` 后自行切换页面状态，不必真的跳转。

失败时（非 JSON 请求）跳转到 `/error?error=form_not_found`、`/error?error=unsupported_content_type` 或 `/error?error=internal_error`。这些页面同样在 FormZero 域名下；如果失败也需要留在目标工程内，同样只能走 JSON 分支自行处理。

## 8. JSON / fetch 提交

`Accept` 或 `Content-Type` 含 `application/json` 时走 JSON 分支：请求体原样存储，成功返回 `201` 和 `{ "success": true, "id": "<submissionId>" }`，失败返回 `4xx/5xx` 与 `{ "success": false, "error": … }`，不重定向。适合 SPA 自己做成功提示的场景：

```js
await fetch("https://YOUR-WORKER/api/forms/YOUR-FORM-ID/submissions", {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({
    name: "John Doe",
    company: "Acme Inc",
    email: "john@example.com",
    projectType: ["Web app", "Mobile app"],
    message: "Hello!",
  }),
});
```

注意 JSON 分支不做重复键合并（本来就无此问题），多选直接传数组。

## 9. 跨域

接口对任意来源开放：`Access-Control-Allow-Origin: *`，允许 `POST` 与 `OPTIONS`，允许 `Content-Type`、`Accept` 头，预检缓存 24 小时。因此在前端工程里直接 `fetch` 该 endpoint 不需要额外配置。

## 10. 排错清单

| 现象                                     | 可能原因                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| 提交后跳到 `/error?error=form_not_found` | `action` 里的 `<formId>` 与后台表单不一致；或该表单已被删除              |
| 多选只存下最后一项                       | 部署的实例不含本次后端改动（见第 4 节）                                  |
| 某个字段没出现在后台                     | `name` 拼写不一致；或该项未填写且没有默认值                              |
| 勾选了但没有视觉反馈                     | 样式规则没命中 `input:checked + span`，检查 DOM 结构与选择器             |
| 键盘无法选择选项                         | 输入框被 `display: none` 隐藏，或 `pointer-events` / `position` 处理不当 |
| 提交后停留在原页却没数据                 | 表单缺少 `method="POST"`，被浏览器按 GET 处理                            |
