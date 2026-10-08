import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function readFileAsBuffer(filePath) {
    let resolvedPath = filePath;

    if (filePath.startsWith("@assets/audio/")) {
        const fileName = filePath.replace("@assets/audio/", "");
        try {
            return await fs.readFile(
                path.join(process.cwd(), "database", "audio", fileName)
            );
        } catch (err) {
            console.error("Error membaca file audio:", err.message);
            return null;
        }
    } else if (filePath.startsWith("@assets/")) {
        const relativePath = filePath.replace("@assets/", "");
        resolvedPath = path.join(
            __dirname,
            "../database/assets",
            relativePath
        );
    } else if (!path.isAbsolute(filePath)) {
        resolvedPath = path.join(process.cwd(), filePath);
    }

    try {
        return await fs.readFile(resolvedPath);
    } catch (err) {
        console.error(`Error membaca file ${filePath}:`, err.message);
        return null;
    }
}

export { readFileAsBuffer };