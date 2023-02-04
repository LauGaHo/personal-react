import {
	// 同步优先级
	unstable_ImmediatePriority as ImmediatePriority,
	// 用户事件优先级，如：点击事件
	unstable_UserBlockingPriority as UserBlockingPriority,
	// 普通事件优先级
	unstable_NormalPriority as NormalPriority,
	// 低优先级
	unstable_LowPriority as LowPriority,
	// 空闲才执行优先级
	unstable_IdlePriority as IdlePriority,
	unstable_scheduleCallback as scheduleCallback,
	unstable_shouldYield as shouldYield,
	CallbackNode,
	unstable_getFirstCallbackNode as getFirstCallbackNode,
	unstable_cancelCallback as cancelCallback
} from 'scheduler';

import './style.css';
const button = document.querySelector('button');
const root = document.querySelector('#root');

type Priority =
	| typeof IdlePriority
	| typeof LowPriority
	| typeof NormalPriority
	| typeof UserBlockingPriority
	| typeof ImmediatePriority;

interface Work {
	// Work 执行的次数
	count: number;
	// 表示 Work 的优先级
	priority: Priority;
}

const workList: Work[] = [];
// 记录上一个 work 实例对象的优先级
let prevPriority: Priority = IdlePriority;
// 记录当前 work 回调函数返回的函数 (如果有的话)
let curCallback: CallbackNode | null = null;

[LowPriority, NormalPriority, UserBlockingPriority, ImmediatePriority].forEach(
	(priority) => {
		const btn = document.createElement('button');
		root?.appendChild(btn);
		btn.innerText = [
			'',
			'ImmediatePriority',
			'UserBlockingPriority',
			'NormalPriority',
			'LowPriority'
		][priority];
		btn.onclick = () => {
			workList.unshift({
				count: 100,
				priority: priority as Priority
			});
			schedule();
		};
	}
);

function schedule() {
	const cbNode = getFirstCallbackNode();
	// 经过排序之后得到的数组就是从小到大的，然后取到第 0 位就是优先级最高的 Work 实例对象
	const curWork = workList.sort((w1, w2) => w1.priority - w2.priority)[0];

	// 策略逻辑
	if (!curWork) {
		curCallback = null;
		cbNode && cancelCallback(cbNode);
		return;
	}

	// 将当前最高优先级的 work 对应的 priority 改名为 curPriority
	const { priority: curPriority } = curWork;
	// 如果当前最高优先级的 work 对应的 priority 全等于上一个调度的 work 的 priority (即 prevPriority)，就不需要开启新的调度
	if (curPriority === prevPriority) {
		return;
	}

	// 调度器在执行上一个回调的过程中产生了一个更高优先级的 work
	// 取消上一个未被执行完的调度任务
	cbNode && cancelCallback(cbNode);

	// 使用调度器调度任务并且将对应的函数和 Work 实例对象传入 scheduleCallback
	curCallback = scheduleCallback(curPriority, perform.bind(null, curWork));
}

function perform(work: Work, didTimeout?: boolean) {
	// 根据当前 Work 实例对象中的 priority 属性是否为同步执行优先级
	// 这里需要注意，Work 同步执行的条件有两个：1. work 本身是 ImmediatePriority。2. 任务超时了
	const needSync = work.priority === ImmediatePriority || didTimeout;
	// 这里是不中断的条件
	while ((needSync || !shouldYield()) && work.count) {
		work.count--;
		insertSpan(work.priority + '');
	}

	// 走到这里同样也有两种可能性：1. work 执行完毕。2. work 被中断执行
	// 为 prevPriority 赋值
	prevPriority = work.priority;
	// 执行完，将其在 workList 中移除
	if (!work.count) {
		const workIndex = workList.indexOf(work);
		workList.splice(workIndex, 1);
		// 如果当前 work 执行完了，需要重置 prevPriority
		prevPriority = IdlePriority;
	}

	// 由于在执行回调的时候，会有产生新的 work 的可能性，所以这里首先记录当前正在调度返回的结果
	const prevCallback = curCallback;
	// 再重新执行一遍调度函数
	schedule();
	// 记录新的一轮调度下返回的调度结果
	const newCallback = curCallback;

	// 如果两轮的调度结果都是相同的话，那么则直接返回当前函数给调度器，调度器会继续调度返回的函数
	if (newCallback && newCallback === prevCallback) {
		return perform.bind(null, work);
	}
}

function insertSpan(content) {
	const span = document.createElement('span');
	span.innerText = content;
	span.className = `pri-${content}`;
	doSomeBusyWork(1000000);
	root?.appendChild(span);
}

function doSomeBusyWork(len: number) {
	let result = 0;
	while (len--) {
		result += len;
	}
}
