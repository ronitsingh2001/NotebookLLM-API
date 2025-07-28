require("dotenv").config(); // Load environment variables

const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const pdfParse = require("pdf-parse");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

// OpenAI config
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Middleware
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// Directories
const UPLOAD_DIR = path.join(__dirname, "uploads");
const TEXT_DIR = path.join(__dirname, "pdf_texts");

[UPLOAD_DIR, TEXT_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    cb(null, `${timestamp}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Only PDF files are allowed!"));
    }
    cb(null, true);
  },
});

app.use("/pdfs", (req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  }, express.static(UPLOAD_DIR));
  

const clearDirectory = (dirPath) => {
  if (fs.existsSync(dirPath)) {
    fs.readdirSync(dirPath).forEach((file) =>
      fs.unlinkSync(path.join(dirPath, file))
    );
  }
};

const preUploadCleanup = (req, res, next) => {
  clearDirectory(UPLOAD_DIR);
  clearDirectory(TEXT_DIR);
  next();
};

app.get("/", (req, res) => res.json({ message: "Server is running" }));

app.post("/upload", preUploadCleanup, upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded!" });
    }

    const filePath = path.join(UPLOAD_DIR, req.file.filename);
    const dataBuffer = fs.readFileSync(filePath);
    const parsed = await pdfParse(dataBuffer);

    const extractedText = parsed.text.trim();
    const baseName = path.parse(req.file.filename).name;
    const textFilePath = path.join(TEXT_DIR, `${baseName}.txt`);

    fs.writeFileSync(textFilePath, extractedText, "utf-8");

    res.status(200).json({
      filename: req.file.filename,
      message: "PDF uploaded and parsed successfully",
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Failed to process PDF" });
  }
});

app.post("/query", async (req, res) => {
  try {
    const { query, filename } = req.body;

    if (!query || !filename) {
      return res
        .status(400)
        .json({ error: "Missing 'query' or 'filename' in request" });
    }

    const baseName = path.parse(filename).name;
    const textFilePath = path.join(TEXT_DIR, `${baseName}.txt`);

    if (!fs.existsSync(textFilePath)) {
      return res.status(404).json({ error: "Parsed text file not found" });
    }

    const fullText = fs.readFileSync(textFilePath, "utf-8");

    const maxChars = 12000;
    const promptText = fullText.length > maxChars ? fullText.slice(0, maxChars) : fullText;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant. Use only the extracted PDF text to answer user questions. Do not assume anything beyond that.",
        },
        {
          role: "system",
          content: promptText,
        },
        {
          role: "user",
          content: query,
        },
      ],
    });

    const response = completion.choices[0].message.content;
    res.status(200).json({ query, response });
  } catch (error) {
    console.error("Query error:", error);
    res.status(500).json({ error: "OpenAI request failed" });
  }
});

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
