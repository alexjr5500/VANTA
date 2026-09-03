import { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth.middleware";
import { searchService } from "../services";

export const search = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const limit = Math.min(parseInt(typeof req.query.limit === "string" ? req.query.limit : "20", 10) || 20, 50);

    if (!query) {
      res.status(400).json({ error: "Search query is required" });
      return;
    }

    const results = await searchService.search(query, type, cursor, limit);
    res.status(200).json(results);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search failed";
    res.status(400).json({ error: message });
  }
};

export const getSuggestions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const limit = Math.min(parseInt(typeof req.query.limit === "string" ? req.query.limit : "10", 10) || 10, 30);
    const suggestions = await searchService.getSuggestions(limit);
    res.status(200).json(suggestions);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get suggestions";
    res.status(400).json({ error: message });
  }
};

export const getTrending = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const limit = Math.min(parseInt(typeof req.query.limit === "string" ? req.query.limit : "10", 10) || 10, 30);
    const trending = await searchService.getTrending(limit);
    res.status(200).json(trending);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get trending";
    res.status(400).json({ error: message });
  }
};