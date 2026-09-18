import type { PlanImport } from "@prisma/client";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireAuth } from "../auth/middleware.js";
import { prisma } from "../db.js";
import * as planImportService from "./plan-import.service.js";
import { PlanImportError } from "./plan-import.service.js";

export const planImportRouter = Router();

planImportRouter.use(requireAuth);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const importOptionsSchema = z.object({
  date: z.string().date().optional(),
});

function toPlanImportDto(p: PlanImport) {
  return {
    id: p.id,
    filename: p.filename,
    format: p.format,
    createdCount: p.createdCount,
    updatedCount: p.updatedCount,
    skippedCount: p.skippedCount,
    warnings: p.warnings,
    importedAt: p.importedAt.toISOString(),
  };
}

planImportRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const imports = await prisma.planImport.findMany({
      where: { athleteId: req.athleteId! },
      orderBy: { importedAt: "desc" },
    });
    res.status(200).json(imports.map(toPlanImportDto));
  }),
);

planImportRouter.post(
  "/",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    const parsedOptions = importOptionsSchema.safeParse(req.body);
    if (!parsedOptions.success) {
      res.status(400).json({ error: parsedOptions.error.flatten() });
      return;
    }
    try {
      const planImport = await planImportService.importPlan(
        req.athleteId!,
        req.file.originalname,
        req.file.buffer,
        parsedOptions.data,
      );
      res.status(201).json(toPlanImportDto(planImport));
    } catch (err) {
      if (err instanceof PlanImportError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      throw err;
    }
  }),
);
