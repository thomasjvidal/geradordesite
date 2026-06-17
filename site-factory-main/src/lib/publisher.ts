import JSZip from "jszip";

export async function publishToVercel(zip: JSZip, projectName: string, token: string): Promise<string> {
  const files: Array<{file: string; data: string; encoding: string}> = [];

  for (const [path, zipFile] of Object.entries(zip.files)) {
    if (zipFile.dir) continue;
    const isText = /\.(html|htm|css|js|json|txt|xml|svg)$/i.test(path);
    let data: string;
    if (isText) {
      const text = await zipFile.async("string");
      data = btoa(unescape(encodeURIComponent(text)));
    } else {
      data = await zipFile.async("base64");
    }
    files.push({ file: path, data, encoding: "base64" });
  }

  const safeName = projectName.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 52);

  const res = await fetch("https://api.vercel.com/v13/deployments", {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: safeName,
      files,
      projectSettings: { framework: null },
      target: "production",
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error?.message || `Vercel error ${res.status}`);
  }

  const data = await res.json();
  return `https://${data.url}`;
}

export async function pushToGitHub(
  zip: JSZip,
  repoName: string,
  token: string,
  owner: string
): Promise<string> {
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Accept": "application/vnd.github+json",
  };
  const safeName = repoName.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");

  await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: safeName, auto_init: false, private: false }),
  });

  for (const [path, zipFile] of Object.entries(zip.files)) {
    if (zipFile.dir) continue;
    const isText = /\.(html|htm|css|js|json|txt|xml|svg)$/i.test(path);
    let content: string;
    if (isText) {
      const text = await zipFile.async("string");
      content = btoa(unescape(encodeURIComponent(text)));
    } else {
      content = await zipFile.async("base64");
    }
    await fetch(`https://api.github.com/repos/${owner}/${safeName}/contents/${path}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ message: `Add ${path}`, content }),
    });
  }

  return `https://github.com/${owner}/${safeName}`;
}
