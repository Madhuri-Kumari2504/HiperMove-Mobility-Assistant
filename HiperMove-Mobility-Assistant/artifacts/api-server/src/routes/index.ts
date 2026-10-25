import { Router, type IRouter } from "express";
import healthRouter from "./health";
import hipermoveRouter from "./hipermove";

const router: IRouter = Router();

router.use(healthRouter);
router.use(hipermoveRouter);

export default router;
