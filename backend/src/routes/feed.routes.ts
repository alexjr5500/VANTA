import { Router } from "express";
import { authenticateJWT } from "../middleware/auth.middleware";
import {
  getFeed,
  getHomeFeed,
  getTrendingFeed,
  getExploreFeed,
  createPost,
  deletePost,
  likePost,
  commentOnPost,
  getPostComments,
  updatePostComment,
  deletePostComment,
  likePostComment,
  getPostCommentReplies,
  reportPostComment,
  getFollowers,
  getFollowing,
} from "../controllers/feed.controller";
import {
  savePost,
  unsavePost,
  getSavedPosts,
  sharePost,
  getPostById,
  viewPost,
} from "../controllers/post.controller";

const router = Router();

router.use(authenticateJWT);

router.get("/", getFeed);
router.get("/home", getHomeFeed);
router.get("/trending", getTrendingFeed);
router.get("/explore", getExploreFeed);
router.get("/saved", getSavedPosts);
router.get("/followers", getFollowers);
router.get("/following", getFollowing);
router.post("/", createPost);
router.delete("/:id", deletePost);
router.post("/:id/like", likePost);
router.post("/:id/share", sharePost);
router.post("/:id/views", viewPost);
router.post("/:id/save", savePost);
router.delete("/:id/save", unsavePost);
router.post("/:id/comments", commentOnPost);
router.get("/:id/comments", getPostComments);
router.put("/:id/comments/:commentId", updatePostComment);
router.delete("/:id/comments/:commentId", deletePostComment);
router.post("/:id/comments/:commentId/like", likePostComment);
router.get("/:id/comments/:commentId/replies", getPostCommentReplies);
router.post("/:id/comments/:commentId/report", reportPostComment);
router.get("/:id", getPostById);

export default router;
