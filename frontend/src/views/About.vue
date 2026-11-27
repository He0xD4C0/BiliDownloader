<template>
  <section class="about">
    <h1>关于 BiliDownloader</h1>
    <p>B 站视频下载工具。仅供学习交流使用，请尊重视频作者的权利。</p>
    <RouterLink to="/">返回下载工作台</RouterLink>
  </section>
</template>

<style scoped>
.about {
  padding: clamp(20px, 4vw, 40px);
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--surface);
}

.about p {
  margin: 12px 0 20px;
  color: var(--muted);
}

.about a {
  color: var(--accent);
  text-underline-offset: 3px;
}
</style>
