import { FiberNode } from './fiber';

// 用于记录抛出 SuspenseExcption 错误组件距离最近的 Suspense 类型的 FiberNode 实例对象
const suspenseHandlerStack: FiberNode[] = [];

/**
 * 获取当前最近的 Suspense 组件的 FiberNode
 *
 * @returns {FiberNode | null} Suspense 组件对应的 FiberNode
 */
export function getSuspenseHandler(): FiberNode | null {
	return suspenseHandlerStack[suspenseHandlerStack.length - 1];
}

/**
 * render 过程中，将路过的 Suspense FiberNode 都丢进 suspenseHandlerStack 中
 *
 * @param {FiberNode} handler - Suspense 类型的 FiberNode 实例对象
 */
export function pushSuspenseHandler(handler: FiberNode) {
	suspenseHandlerStack.push(handler);
}

/**
 * 弹出 suspenseHandlerStack 的顶层 FiberNode 实例对象
 *
 */
export function popSuspenseHandler() {
	suspenseHandlerStack.pop();
}
