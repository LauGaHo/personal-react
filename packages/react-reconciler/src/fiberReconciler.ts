import { Container } from 'hostConfig';
import {
	unstable_ImmediatePriority,
	unstable_runWithPriority
} from 'scheduler';
import { ReactElementType } from 'shared/ReactTypes';
import { FiberNode, FiberRootNode } from './fiber';
import { requestUpdateLane } from './fiberLanes';
import {
	createUpdate,
	createUpdateQueue,
	enqueueUpdate,
	UpdateQueue
} from './updateQueue';
import { scheduleUpdateOnFiber } from './workLoop';
import { HostRoot } from './workTags';

// 创建 fiberRootNode，并把 fiberRootNode 和 hostRootFiber 关联起来
export function createContainer(container: Container) {
	const hostRootFiber = new FiberNode(HostRoot, {}, null);
	const root = new FiberRootNode(container, hostRootFiber);
	hostRootFiber.updateQueue = createUpdateQueue();
	return root;
}

// 创建 Update 对象，并把 Update 对象 enqueue 到 updateQueue 中
export function updateContainer(
	element: ReactElementType | null,
	root: FiberRootNode
) {
	// 将回调丢进 Scheduler 中进行执行，并且是按照同步更新逻辑来执行
	unstable_runWithPriority(unstable_ImmediatePriority, () => {
		const hostRootFiber = root.current;
		// 由于回调使用了同步优先级，所以这里请求的 lane 同样也是同步优先级，因为这里是获取调度器当前任务的优先级的
		const lane = requestUpdateLane();
		const update = createUpdate<ReactElementType | null>(element, lane);
		enqueueUpdate(
			hostRootFiber.updateQueue as UpdateQueue<ReactElementType | null>,
			update
		);
		scheduleUpdateOnFiber(hostRootFiber, lane);
	});
	return element;
}
