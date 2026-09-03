import { Router } from "express";
import { authenticateJWT } from "../middleware/auth.middleware";
import { search, getSuggestions, getTrending } from "../controllers/search.controller";

const router = Router();

router.get("/", authenticateJWT, search);
router.get("/suggestions", authenticateJWT, getSuggestions);
router.get("/trending", authenticateJWT, getTrending);

export default router;