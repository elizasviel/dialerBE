import express from "express";
import cors from "cors";
import csvUploader from "./csvUploader";

const app = express();

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use("/api", csvUploader);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
