import { FiberNode } from 'react-reconciler/src/fiber';
import { HostText } from 'react-reconciler/src/workTags';
import { Props } from 'shared/ReactTypes';

export interface Container {
	rootID: number;
	children: (Instance | TextInstance)[];
}

export interface Instance {
	id: number;
	type: string;
	children: (Instance | TextInstance)[];
	parent: number;
	props: Props;
}

export interface TextInstance {
	text: string;
	id: number;
	parent: number;
}

// 定义全局变量用于记录当前最新的 id 是多少
let instanceCounter = 0;

// export const createInstance = (type: string, props: any): Instance => {
export const createInstance = (type: string, props: Props): Instance => {
	const instance = {
		id: instanceCounter++,
		type,
		children: [],
		parent: -1,
		props
	};
	return instance;
};

export const appendInitialChild = (
	parent: Instance | Container,
	child: Instance
) => {
	// 这里获取到的 prevParent 变量的类型是 number
	const prevParentId = child.parent;
	const parentID = 'rootID' in parent ? parent.rootID : parent.id;

	// 这里挂载的一个大前提就是被挂载的元素，事先不能已经被挂载过
	if (prevParentId !== -1 && prevParentId !== parentID) {
		throw new Error('不能重复挂载 child');
	}
	child.parent = parentID;
	parent.children.push(child);
};

export const createTextInstance = (content: string) => {
	const instance = {
		text: content,
		id: instanceCounter++,
		parent: -1
	};
	return instance;
};

export const appendChildToContainer = (parent: Container, child: Instance) => {
	// 这里获取到的 prevParent 变量的类型是 number
	const prevParentId = child.parent;

	if (prevParentId !== -1 && prevParentId !== parent.rootID) {
		throw new Error('不能重复挂载 child');
	}
	child.parent = parent.rootID;
	parent.children.push(child);
};

// 提交 Update 操作
export function commitUpdate(fiber: FiberNode) {
	switch (fiber.tag) {
		case HostText:
			const text = fiber.memoizedProps?.content;
			return commitTextUpdate(fiber.stateNode, text);

		default:
			if (__DEV__) {
				console.warn('未实现的 Update 类型', fiber);
			}
			break;
	}
}

// 实际对 Text 进行 Update 操作
export function commitTextUpdate(textInstance: TextInstance, content: string) {
	textInstance.text = content;
}

// 移除某个 DOM 节点下的某个 child 节点
export function removeChild(
	child: Instance | TextInstance,
	container: Container
) {
	const index = container.children.indexOf(child);

	if (index === -1) {
		throw new Error('child 不存在');
	}
	container.children.splice(index, 1);
}

// 将目标 DOM 插入到容器中某个 DOM 的前面
export function insertChildToContainer(
	child: Instance,
	container: Container,
	before: Instance
) {
	const beforeIndex = container.children.indexOf(before);
	if (beforeIndex === -1) {
		throw new Error('before 不存在');
	}
	const index = container.children.indexOf(child);
	if (index !== -1) {
		container.children.splice(index, 1);
	}
	container.children.splice(beforeIndex, 0, child);
}

// 根据宿主环境获取支持微任务的形式，用于使用微任务执行调度任务
export const scheduleMicroTask =
	typeof queueMicrotask === 'function'
		? queueMicrotask
		: typeof Promise === 'function'
		? (callback: (...args: any) => void) => Promise.resolve(null).then(callback)
		: setTimeout;
