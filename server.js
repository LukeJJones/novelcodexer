const express = require("express");
const multer = require("multer");
const fs = require("fs-extra");
const path = require("path");
const AdmZip = require("adm-zip");
const archiver = require("archiver");
const os = require("os");
const yaml = require("js-yaml");

const app = express();
const upload = multer({ dest: "uploads/" });
const PORT = 3000;

const CATEGORIES = ["lore", "objects", "other", "locations", "characters"];

// Serve frontend from public folder
app.use(express.static("public"));

app.post("/upload", upload.single("codexZip"), async (req, res) => {
  if (!req.file || !req.file.originalname.endsWith(".zip")) {
    return res.status(400).send("Please upload a valid .zip file.");
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-"));

  try {
    // Extract uploaded .zip using adm-zip
    const zip = new AdmZip(req.file.path);
    zip.extractAllTo(tempDir, true);

    const outputDir = path.join(tempDir, "output");
    await fs.ensureDir(outputDir);

    // Merge entry.md files for each category
    for (const category of CATEGORIES) {
      const categoryPath = path.join(tempDir, category);
      if (!(await fs.pathExists(categoryPath))) continue;

      const folders = await fs.readdir(categoryPath);
      let combined = "";

      for (const folder of folders) {
        const entryPath = path.join(categoryPath, folder, "entry.md");
        if (await fs.pathExists(entryPath)) {
          const content = await fs.readFile(entryPath, "utf-8");
          const parts = content.split("---\n");
          let frontMatter = {};
          let markdownBody = content;

          if (parts.length > 2 && parts[0].trim() === "") {
            frontMatter = yaml.load(parts[1]);
            markdownBody = parts.slice(2).join("---\n");
          }

          const excludedFields = [
            "aliases",
            "tags",
            "alwaysIncludeInContext",
            "doNotTrack",
            "noAutoInclude",
            "color",
          ];
          for (const field of excludedFields) {
            delete frontMatter[field];
          }

          let formattedContent = ``;

          const entryName = frontMatter.name || "Untitled";
          const entryType = frontMatter.type || "Unknown";

          formattedContent += `# ${entryName}\n\n`;

          for (const key in frontMatter) {
            if (key === "name") continue;

            let displayKey = key;
            const value = frontMatter[key];

            if (key === "fields") {
              if (typeof value === "object" && value !== null && Object.keys(value).length === 0) {
                continue; // Omit "Attributes" header if no child attributes
              }
              displayKey = "Attributes";
            }

            formattedContent += `## ${displayKey.charAt(0).toUpperCase() + displayKey.slice(1)}\n`;

            if (typeof value === "object" && value !== null) {
              for (const subKey in value) {
                formattedContent += `### ${subKey.charAt(0).toUpperCase() + subKey.slice(1)}\n`;
                formattedContent += `${value[subKey]}\n\n`;
              }
            } else {
              formattedContent += `${value}\n\n`;
            }
          }

          formattedContent += `## Description\n${markdownBody}`;

          combined += `\n\n${formattedContent}\n\n`;
        }
      }

      if (combined.trim()) {
        const outPath = path.join(outputDir, `${category}.md`);
        await fs.writeFile(outPath, combined.trim());
      }
    }

    // Create final codex.zip
    const zipPath = path.join(tempDir, "codex.zip");
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip");

    archive.pipe(output);
    archive.directory(outputDir, false);
    await archive.finalize();

    // Wait for zip to finish and send it
    output.on("close", () => {
      res.download(zipPath, "codex.zip", async () => {
        // Clean up after download
        await fs.remove(tempDir);
        await fs.remove(req.file.path);
      });
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Something went wrong.");
    await fs.remove(tempDir);
    await fs.remove(req.file.path);
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
