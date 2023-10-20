import { FiberNode } from './fiber';
import { popProvider } from './fiberContext';
import { DidCapture, NoFlags, ShouldCapture } from './fiberFlags';
import { popSuspenseHandler } from './suspenseContext';
import { ContextProvider, SuspenseComponent } from './workTags';

/**
 * Suspense 的 unwind 操作，针对 Suspense FiberNode 是对 ShouldCapture 的 Suspense 标记上 DidCapture 标记
 * 然后返回对应的 FiberNode 以此来继续进行 beginWork
 *
 * @param {FiberNode} wip - unwind 操作一直向上走过程中经过的 fiberNode
 * @returns {FiberNode | null} 返回 Suspense 对应的 FiberNode 或者什么都不返回
 */
export function unwindWork(wip: FiberNode): FiberNode | null {
	const flags = wip.flags;

	switch (wip.tag) {
		case SuspenseComponent:
			popSuspenseHandler();
			// 标记了 ShouldCapture 并且还未被处理
			if (
				(flags & ShouldCapture) !== NoFlags &&
				(flags & DidCapture) === NoFlags
			) {
				// remove the ShouldCapture flags and add DidCapture flags
				wip.flags = (flags & ~ShouldCapture) | DidCapture;
				// 直接返回当前最近的 Suspense FiberNode
				return wip;
			}
			break;

		case ContextProvider:
			const context = wip.type.__context;
			popProvider(context);
			return null;

		default:
			return null;
	}
	return null;
}
