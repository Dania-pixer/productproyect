import express from "express";
import dotenv from "dotenv";
import { db } from "./db.js";
import { s3, PutObjectCommand, DeleteObjectCommand } from "./s3.js";

dotenv.config();

const app = express();
app.use(express.json());

// -----------------------------------------------------
// CREATE PRODUCT + GENERATE JSON + UPLOAD TO S3
// -----------------------------------------------------
app.post("/products", async (req, res) => {
  try {
    const { name, price } = req.body;

    if (!name || !price) {
      return res.status(400).json({ error: "Faltan datos" });
    }

    // 1. Insertar en la BD
    const [result] = await db.execute(
      "INSERT INTO products (name, price) VALUES (?, ?)",
      [name, price]
    );

    const id = result.insertId;
    const createdAt = new Date().toISOString();

    // 2. Crear JSON
    const productJson = {
      id,
      name,
      price,
      createdAt
    };

    const fileName = `product_${id}.json`;

    // 3. Subir JSON a S3
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET_NAME,
        Key: fileName,
        Body: JSON.stringify(productJson),
        ContentType: "application/json"
      })
    );

    // URL correcta del bucket regional
    const fileUrl = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;

    // 4. Guardar URL en BD
    await db.execute(
      "UPDATE products SET fileUrl=? WHERE id=?",
      [fileUrl, id]
    );

    res.json({
      message: "Producto creado + JSON generado en S3",
      data: productJson,
      fileUrl
    });

  } catch (error) {
    console.log(error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

// -----------------------------------------------------
// GET ALL PRODUCTS
// -----------------------------------------------------
app.get("/products", async (req, res) => {
  const [rows] = await db.execute("SELECT * FROM products");
  res.json(rows);
});

// -----------------------------------------------------
// GET SINGLE PRODUCT
// -----------------------------------------------------
app.get("/products/:id", async (req, res) => {
  const [rows] = await db.execute(
    "SELECT * FROM products WHERE id = ?",
    [req.params.id]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: "Producto no encontrado" });
  }

  res.json(rows[0]);
});

// -----------------------------------------------------
// UPDATE PRODUCT
// -----------------------------------------------------
app.put("/products/:id", async (req, res) => {
  const { name, price } = req.body;

  await db.execute(
    "UPDATE products SET name=?, price=? WHERE id=?",
    [name, price, req.params.id]
  );

  res.json({ message: "Producto actualizado" });
});

// -----------------------------------------------------
// DELETE PRODUCT + DELETE JSON FROM S3
// -----------------------------------------------------
app.delete("/products/:id", async (req, res) => {
  const id = req.params.id;

  // Obtener archivo en S3 para poder borrar
  const [rows] = await db.execute(
    "SELECT fileUrl FROM products WHERE id = ?",
    [id]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: "Producto no encontrado" });
  }

  const fileUrl = rows[0].fileUrl;
  const key = fileUrl.split(".com/")[1];

  // 1. Eliminar archivo en S3
  await s3.send(
    new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key
    })
  );

  // 2. Eliminar de BD
  await db.execute("DELETE FROM products WHERE id=?", [id]);

  res.json({
    message: "Producto eliminado + archivo JSON eliminado de S3"
  });
});

app.listen(process.env.PORT || 3000, () =>
  console.log("API corriendo en puerto 3000")
);
