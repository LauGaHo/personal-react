import { Wakeable } from 'shared/ReactTypes';
import { FiberRootNode } from './fiber';
import { ShouldCapture } from './fiberFlags';
import { Lane } from './fiberLanes';
import { ensureRootIsScheduled, markRootUpdated } from './workLoop';
import { getSuspenseHandler } from './suspenseContext';

/**
 * 对 Thenable 进行包装，使其变成 Wakeable 实例对象
 *
 * @param {FiberRootNode} root - workInProgress 树的根节点
 * @param {any} value - 对于 Suspense 情景是一个 Thenable 实例对象
 * @param {Lane} lane - 本次更新的 Lane
 */
export function throwException(root: FiberRootNode, value: any, lane: Lane) {
	// Error Boundary
	// thenable
	if (
		value !== null &&
		typeof value === 'object' &&
		typeof value.then === 'function'
	) {
		const wakeable: Wakeable<any> = value;

		// 获取当前最近的 Suspense 组件的 FiberNode 实例对象
		const suspenseBoundary = getSuspenseHandler();
		if (suspenseBoundary) {
			// 并且需要将其加上一个 ShouldCapture 的 flags
			suspenseBoundary.flags |= ShouldCapture;
		}

		attachPingListener(root, wakeable, lane);
	}
}

function attachPingListener(
	root: FiberRootNode,
	wakeable: Wakeable<any>,
	lane: Lane
) {
	let pingCache = root.pingCache;

	let threadIDs: Set<Lane> | undefined;

	if (pingCache === null) {
		threadIDs = new Set<Lane>();
		pingCache = root.pingCache = new WeakMap<Wakeable<any>, Set<Lane>>();
		pingCache.set(wakeable, threadIDs);
	} else {
		threadIDs = pingCache.get(wakeable);

		if (threadIDs === undefined) {
			threadIDs = new Set<Lane>();
			pingCache.set(wakeable, threadIDs);
		}
	}

	// 判斷是否第一次進入
	// 这里的目的是为了防止重复绑定 ping 方法，导致 render 重复执行
	// 如果 threadIDs.has(lane) 为 true 表示当前的 wakeable 已经绑定了 then 回调，但是还未执行而已，所以不用重复绑定了
	if (!threadIDs.has(lane)) {
		threadIDs.add(lane);

		// 定義 ping 方法
		function ping() {
			if (pingCache !== null) {
				pingCache.delete(wakeable);
			}
			// 相當於是觸發一次新的更新
			markRootUpdated(root, lane);
			ensureRootIsScheduled(root);
		}

		wakeable.then(ping, ping);
	}
}
