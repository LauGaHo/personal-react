import './style.css';
const button = document.querySelector('button');
const root = document.querySelector('#root');

interface Work {
	// Work 执行的次数
	count: number;
}

const workList: Work[] = [];

function schedule() {
	const curWork = workList.pop();

	if (curWork) {
		perform(curWork);
	}
}

function perform(work: Work) {
	while (work.count) {
		work.count--;
		insertSpan('0');
	}
	schedule();
}

function insertSpan(content) {
	const span = document.createElement('span');
	span.innerText = content;
	root?.appendChild(span);
}

button &&
	(button.onclick = () => {
		workList.unshift({
			count: 100
		});
		schedule();
	});
