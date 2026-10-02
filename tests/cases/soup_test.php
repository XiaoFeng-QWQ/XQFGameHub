<?php

/**
 * 海龟汤模式测试（需本机 Redis + MySQL 运行）。
 *
 * 覆盖三块：
 *   1. 纯逻辑 —— 官方种子题库结构、AI 判定 JSON 解析、汤面字段校验、公开视图裁剪、房间编解码往返
 *   2. Redis  —— SoupService 房间/客户端绑定生命周期、大厅与后台房间列表过滤
 *   3. MySQL  —— SoupPuzzleRepository 增删改查与越权防护、SoupPuzzleService 共享与选题、
 *                SoupRecordRepository 战绩写入与汇总
 *
 * 测试数据均使用随机 owner_id / player_id，并在 finally 中精确清理，不影响线上数据。
 */

use App\Services\Infrastructure\Database;
use App\Services\Repository\SoupPuzzleRepository;
use App\Services\Repository\SoupRecordRepository;
use App\Services\Soup\SoupJudgeService;
use App\Services\Soup\SoupPuzzleService;
use App\Services\Soup\SoupQuestionBankService;
use App\Services\Soup\SoupService;

// ==================== 测试辅助 ====================

/** 调用对象的私有方法（用于测试内部纯函数） */
function soup_test_call_private(object $obj, string $method, array $args = []): mixed
{
    // PHP 8.1+ 反射默认可访问私有成员，无需 setAccessible
    return (new ReflectionMethod($obj, $method))->invokeArgs($obj, $args);
}

/** 生成唯一测试标识（房间号 / owner_id / player_id） */
function soup_test_uid(string $prefix = 'T'): string
{
    return $prefix . strtoupper(bin2hex(random_bytes(5)));
}

/** 构造一个用于 SoupService 的房间数组 */
function soup_test_room(string $id, int $fd, string $state, int $max, int $memberCount): array
{
    $members = [];
    for ($i = 0; $i < $memberCount; $i++) {
        $members[] = [
            'fd'       => $fd + $i,
            'playerId' => 'soup_test_p' . ($fd + $i),
            'nickname' => 'P' . $i,
            'role'     => $i === 0 ? 'host' : 'guesser',
        ];
    }
    return [
        'id'            => $id,
        'name'          => '测试房',
        'hostFd'        => $fd,
        'hostPlayerId'  => 'soup_test_p' . $fd,
        'hostNickname'  => '房主',
        'state'         => $state,
        'maxPlayers'    => $max,
        'aiAssist'      => false,
        'puzzle'        => null,
        'hintsRevealed' => 0,
        'questions'     => [],
        'seq'           => 0,
        'usedPuzzleIds' => [],
        'members'       => $members,
        'created_at'    => date('Y-m-d H:i:s'),
        'startedAt'     => 0,
    ];
}

// ==================== 纯逻辑：官方种子题库 ====================

function test_soup_question_bank_structure(): void
{
    $bank = SoupQuestionBankService::all();
    assert_true(is_array($bank) && count($bank) > 0, '官方题库不应为空');

    foreach ($bank as $i => $p) {
        assert_true(!empty($p['title']), "第 {$i} 题缺 title");
        assert_true(!empty($p['surface']), "第 {$i} 题缺 surface");
        assert_true(!empty($p['truth']), "第 {$i} 题缺 truth");
        assert_true(is_array($p['key_points'] ?? null), "第 {$i} 题 key_points 应为数组");
        assert_true(is_array($p['hints'] ?? null), "第 {$i} 题 hints 应为数组");
        $d = (int)($p['difficulty'] ?? 0);
        assert_true($d >= 1 && $d <= 3, "第 {$i} 题 difficulty 应在 1~3，实际 {$d}");
    }
}

function test_soup_question_bank_unique_titles(): void
{
    $titles = array_column(SoupQuestionBankService::all(), 'title');
    assert_eq(count($titles), count(array_unique($titles)), '种子题标题应唯一（入库去重依赖 title）');
}

// ==================== 纯逻辑：AI 判定解析 ====================

function test_soup_judge_parse_valid(): void
{
    $svc = new SoupJudgeService();

    $r = soup_test_call_private($svc, 'parse', ['{"suggested_verdict":"yes","reason":"与真相一致"}']);
    assert_eq('yes', $r['verdict']);
    assert_eq('与真相一致', $r['reason']);

    // 支持 verdict 别名 + Markdown 代码块围栏
    $r = soup_test_call_private($svc, 'parse', ["```json\n{\"verdict\":\"close\",\"reason\":\"非常接近\"}\n```"]);
    assert_eq('close', $r['verdict'], '应支持 verdict 别名并剥离围栏');
    assert_eq('非常接近', $r['reason']);
}

function test_soup_judge_parse_invalid(): void
{
    $svc = new SoupJudgeService();

    assert_eq(null, soup_test_call_private($svc, 'parse', ['{"suggested_verdict":"maybe"}']), '非法档位应返回 null');
    assert_eq(null, soup_test_call_private($svc, 'parse', ['这里没有任何 JSON']), '非 JSON 应返回 null');
    assert_eq(null, soup_test_call_private($svc, 'parse', ['{"suggested_verdict":"yes"']), '截断 JSON 应返回 null');

    // 缺 reason 用默认值，超长 reason 截断到 80 字
    $r = soup_test_call_private($svc, 'parse', ['{"suggested_verdict":"no"}']);
    assert_eq('no', $r['verdict']);
    assert_true($r['reason'] !== '', '缺 reason 时应有默认文案');

    $long = str_repeat('长', 120);
    $r = soup_test_call_private($svc, 'parse', ['{"suggested_verdict":"unrelated","reason":"' . $long . '"}']);
    assert_true(mb_strlen($r['reason']) <= 80, 'reason 应截断到 80 字以内');
}

function test_soup_judge_suggest_empty_question_returns_null(): void
{
    $svc = new SoupJudgeService();
    assert_eq(null, $svc->suggest(['surface' => '面', 'truth' => '底'], ''), '空提问不应调用 AI，直接返回 null');
}

// ==================== 纯逻辑：字段校验与公开视图裁剪 ====================

function test_soup_puzzle_service_validate_rules(): void
{
    $svc = new SoupPuzzleService();

    assert_eq(null, soup_test_call_private($svc, 'validate', [['surface' => '', 'truth' => 'x']]), '空汤面应校验失败');
    assert_eq(null, soup_test_call_private($svc, 'validate', [['surface' => 'x', 'truth' => '  ']]), '空汤底应校验失败');

    $clean = soup_test_call_private($svc, 'validate', [[
        'surface'    => '面',
        'truth'      => '底',
        'difficulty' => 9,
        'key_points' => [' a ', '', 'b'],
        'hints'      => ['h1', '   '],
        'tags'       => '惊悚',
        'is_public'  => true,
    ]]);
    assert_eq('面', $clean['surface']);
    assert_eq('底', $clean['truth']);
    assert_eq(3, $clean['difficulty'], 'difficulty 应钳制到上限 3');
    assert_eq(['a', 'b'], $clean['key_points'], '关键点应 trim 并剔除空项');
    assert_eq(['h1'], $clean['hints'], '提示应 trim 并剔除空项');
    assert_true(!array_key_exists('scope', $clean), '新建汤面一律私有，is_public 不再决定作用域');
    assert_true($clean['title'] !== '', 'title 为空时应从 surface 自动生成');

    $dirty = soup_test_call_private($svc, 'validate', [[
        'surface' => '<script>alert(1)</script>汤面',
        'truth'   => '汤底',
    ]]);
    assert_not_contains('<script>', $dirty['surface'], '汤面应被 XSS 清理');
}

function test_soup_puzzle_service_public_view_shows_truth_and_author(): void
{
    $svc = new SoupPuzzleService();

    // 官方题：公开即作品，汤底对所有人可见，作者显示「官方」
    $official = soup_test_call_private($svc, 'toPublicView', [[
        'id'         => 7,
        'source'     => 'official',
        'owner_id'   => '',
        'scope'      => 'public',
        'title'      => '标题',
        'surface'    => '汤面',
        'truth'      => '机密汤底',
        'key_points' => ['关键点'],
        'difficulty' => 2,
        'tags'       => '惊悚',
        'used_count' => 5,
    ]]);
    assert_eq(7, $official['id']);
    assert_eq(5, $official['used_count']);
    assert_eq('机密汤底', $official['truth'], '公开池应展示汤底');
    assert_eq('官方', $official['author']);

    // 玩家公开题：作者取昵称
    $member = soup_test_call_private($svc, 'toPublicView', [[
        'id' => 8, 'source' => 'member', 'owner_id' => 'u1', 'scope' => 'public',
        'title' => 't', 'surface' => 's', 'truth' => 'x', 'difficulty' => 1,
        'tags' => '', 'used_count' => 0,
    ], ['u1' => '小明']]);
    assert_eq('小明', $member['author']);

    // 作者昵称缺失：显示「已注销用户」
    $gone = soup_test_call_private($svc, 'toPublicView', [[
        'id' => 9, 'source' => 'member', 'owner_id' => 'u2', 'scope' => 'public',
        'title' => 't', 'surface' => 's', 'truth' => 'x', 'difficulty' => 1,
        'tags' => '', 'used_count' => 0,
    ], []]);
    assert_eq('已注销用户', $gone['author'], '作者不存在时应显示已注销用户');

    // 衍生作品：署名指向最初的原始作者，而非复制者
    $deriv = soup_test_call_private($svc, 'toPublicView', [[
        'id' => 10, 'source' => 'member', 'owner_id' => 'copier', 'origin_author_id' => 'u1',
        'scope' => 'public', 'title' => 't', 'surface' => 's', 'truth' => 'x',
        'difficulty' => 1, 'tags' => '', 'used_count' => 0,
    ], ['u1' => '小明', 'copier' => '复制者']]);
    assert_eq('小明', $deriv['author'], '衍生作品应署名原始作者');
    assert_true(!empty($deriv['is_derivative']), '衍生作品应带 is_derivative 标记');

    // 原始作者账号已注销：衍生作品显示「已注销用户」
    $derivGone = soup_test_call_private($svc, 'toPublicView', [[
        'id' => 11, 'source' => 'member', 'owner_id' => 'copier', 'origin_author_id' => 'u2',
        'scope' => 'public', 'title' => 't', 'surface' => 's', 'truth' => 'x',
        'difficulty' => 1, 'tags' => '', 'used_count' => 0,
    ], ['copier' => '复制者']]);
    assert_eq('已注销用户', $derivGone['author'], '原始作者注销后衍生作品应显示已注销用户');

    // 官方题的衍生作品：原作者显示「官方」
    $derivOfficial = soup_test_call_private($svc, 'toPublicView', [[
        'id' => 12, 'source' => 'member', 'owner_id' => 'copier', 'origin_author_id' => 'official',
        'scope' => 'public', 'title' => 't', 'surface' => 's', 'truth' => 'x',
        'difficulty' => 1, 'tags' => '', 'used_count' => 0,
    ], ['copier' => '复制者']]);
    assert_eq('官方', $derivOfficial['author'], '官方题的衍生作品应署名官方');
}

// ==================== 纯逻辑：房间编解码往返 ====================

function test_soup_service_room_encode_decode_roundtrip(): void
{
    $svc = new SoupService();
    $room = soup_test_room('RT1', 42, 'playing', 6, 2);
    $room['aiAssist']      = true;
    $room['puzzle']        = ['id' => 3, 'title' => '汤', 'truth' => '真相'];
    $room['hintsRevealed'] = 1;
    $room['questions']     = [['id' => 1, 'text' => '是人为吗']];
    $room['seq']           = 1;
    $room['usedPuzzleIds'] = [3];
    $room['startedAt']     = 1759300000;

    $encoded = soup_test_call_private($svc, 'encodeRoom', [$room]);
    $decoded = soup_test_call_private($svc, 'decodeRoom', [$encoded]);

    assert_eq('RT1', $decoded['id']);
    assert_eq(42, $decoded['hostFd'], 'hostFd 应还原为 int');
    assert_eq(6, $decoded['maxPlayers'], 'maxPlayers 应还原为 int');
    assert_true($decoded['aiAssist'] === true, 'aiAssist 应还原为 bool');
    assert_eq(3, $decoded['puzzle']['id'], 'puzzle 应还原为数组');
    assert_eq(1, $decoded['seq']);
    assert_eq([3], $decoded['usedPuzzleIds']);
    assert_eq(1, count($decoded['questions']));
    assert_eq(2, count($decoded['members']));
    assert_eq(1759300000, $decoded['startedAt']);
}

// ==================== Redis：SoupService ====================

function test_soup_service_room_crud(): void
{
    $svc    = new SoupService();
    $roomId = soup_test_uid('R');
    try {
        $svc->setRoom($roomId, soup_test_room($roomId, 9001, 'lobby', 4, 1));
        assert_true($svc->roomExists($roomId), '写入后房间应存在');

        $got = $svc->getRoom($roomId);
        assert_true($got !== null, '应能读回房间');
        assert_eq($roomId, $got['id']);
        assert_eq('lobby', $got['state']);
        assert_eq(4, $got['maxPlayers']);
        assert_eq(1, count($got['members']));
    } finally {
        $svc->deleteRoom($roomId);
    }
    assert_true(!$svc->roomExists($roomId), '删除后房间不应存在');
    assert_eq(null, $svc->getRoom($roomId), '删除后应读不到房间');
}

function test_soup_service_client_binding(): void
{
    $svc = new SoupService();
    $fd  = 990001;
    try {
        $svc->setClient($fd, 'ROOMX', 'host', 'pid1');
        $c = $svc->getClient($fd);
        assert_eq('ROOMX', $c['roomId']);
        assert_eq('host', $c['role']);
        assert_eq('pid1', $c['playerId']);
    } finally {
        $svc->deleteClient($fd);
    }
    assert_eq(null, $svc->getClient($fd), '解绑后应读不到客户端');
}

function test_soup_service_room_lists_filtering(): void
{
    $svc   = new SoupService();
    $open  = soup_test_uid('O');
    $play  = soup_test_uid('G');
    $full  = soup_test_uid('F');
    try {
        // 未满 lobby → 应出现在大厅
        $svc->setRoom($open, soup_test_room($open, 991000, 'lobby', 4, 1));
        // 进行中 → 不应出现在大厅，但后台可见
        $svc->setRoom($play, soup_test_room($play, 991100, 'playing', 4, 2));
        // 已满 lobby → 不应出现在大厅
        $svc->setRoom($full, soup_test_room($full, 991200, 'lobby', 2, 2));

        $openIds = array_column($svc->listOpenRooms(), 'id');
        assert_true(in_array($open, $openIds, true), '未满的 lobby 房间应出现在大厅');
        assert_true(!in_array($play, $openIds, true), '进行中的房间不应出现在大厅');
        assert_true(!in_array($full, $openIds, true), '人数已满的房间不应出现在大厅');

        $adminRows = $svc->listRoomsForAdmin();
        $adminIds  = array_column($adminRows, 'id');
        assert_true(in_array($play, $adminIds, true), '后台应能监视进行中的房间');
        assert_true(in_array($full, $adminIds, true), '后台应能监视已满房间');
    } finally {
        $svc->deleteRoom($open);
        $svc->deleteRoom($play);
        $svc->deleteRoom($full);
    }
}

// ==================== MySQL：汤面库 ====================

function test_soup_puzzle_repository_crud_and_ownership(): void
{
    SoupPuzzleRepository::ensureTable();
    $owner = soup_test_uid('soup_test_');
    $pdo   = Database::connect();

    try {
        $id = SoupPuzzleRepository::create($owner, [
            'title'      => '测试汤面',
            'surface'    => '一个人死了',
            'truth'      => '其实是被自己绊倒摔死的',
            'key_points' => ['关键1', '关键2'],
            'hints'      => ['提示1'],
            'difficulty' => 2,
            'tags'       => '惊悚,经典',
            'scope'      => 'private',
        ]);
        assert_true(is_int($id) && $id > 0, '创建应返回自增 id');

        $row = SoupPuzzleRepository::findById($id);
        assert_eq('测试汤面', $row['title']);
        assert_eq('member', $row['source'], '玩家上传应为 member 来源');
        assert_eq(2, $row['difficulty']);
        assert_eq(['关键1', '关键2'], $row['key_points'], 'key_points 应 JSON 解码为数组');
        assert_eq(['提示1'], $row['hints'], 'hints 应 JSON 解码为数组');

        assert_eq(1, count(SoupPuzzleRepository::listByOwner($owner)), '我的列表应含 1 条');
        assert_eq(1, SoupPuzzleRepository::countByOwner($owner), '配额计数应为 1');

        // 改值后更新（同值更新 rowCount 为 0，故必须真正改动字段）
        assert_true(SoupPuzzleRepository::update($id, $owner, [
            'title'      => '改后标题',
            'surface'    => '改后汤面',
            'truth'      => '改后汤底',
            'key_points' => [],
            'hints'      => [],
            'difficulty' => 3,
            'tags'       => '',
            'scope'      => 'private',
        ]), '本人更新应成功');
        assert_eq('改后标题', SoupPuzzleRepository::findById($id)['title']);

        // 越权防护
        assert_true(!SoupPuzzleRepository::update($id, 'other_owner', ['title' => 'x', 'surface' => 'y', 'truth' => 'z']), '非本人不能更新');
        assert_true(!SoupPuzzleRepository::delete($id, 'other_owner'), '非本人不能删除');

        // 本人删除
        assert_true(SoupPuzzleRepository::delete($id, $owner), '本人应能删除');
        assert_true(SoupPuzzleRepository::findById($id) === null, '删除后应查不到');
    } finally {
        $pdo->exec('DELETE FROM soup_puzzles WHERE owner_id = ' . $pdo->quote($owner));
    }
}

function test_soup_puzzle_service_publish_and_resolve(): void
{
    SoupPuzzleRepository::ensureTable();
    $owner  = soup_test_uid('soup_test_');
    $copier = soup_test_uid('soup_copy_');
    $svc    = new SoupPuzzleService();
    $pdo    = Database::connect();
    $puzzleId = 0;

    try {
        $created = $svc->create($owner, [
            'title'     => '公开测试',
            'surface'   => '汤面内容',
            'truth'     => '机密汤底',
            'is_public' => true, // 已废弃：新建一律私有
        ]);
        assert_true(!empty($created['success']), '创建应成功: ' . ($created['error'] ?? ''));
        $puzzleId = (int)$created['id'];

        // 新建即为私有：可作为自己的题选，不能作为公开题选
        assert_true(!$svc->resolveForRoom($owner, 'public', $puzzleId)['success'], '私有题不应能作为公开题选');
        $mine = $svc->resolveForRoom($owner, 'mine', $puzzleId);
        assert_true($mine['success'], '自己的私有题应可选');
        assert_eq('机密汤底', $mine['puzzle']['truth'], '服务端选题应能拿到汤底');

        // 公开（单向不可逆）
        $published = $svc->publish($owner, $puzzleId);
        assert_true(!empty($published['success']), '公开应成功');
        assert_eq('public', $published['scope']);

        // 公开后永久退出可游玩池：本人也不能再用于创建房间
        assert_true(!$svc->resolveForRoom($owner, 'mine', $puzzleId)['success'], '已公开的汤面不应能用于创建房间');

        // 不可撤回 / 不可编辑
        assert_true(empty($svc->publish($owner, $puzzleId)['success']), '已公开的汤面不可重复公开或撤回');
        assert_true(empty($svc->update($owner, $puzzleId, ['surface' => '改', 'truth' => '改'])['success']), '已公开的汤面不可编辑');

        // 公开池包含该题，且汤底对所有人可见
        $found = null;
        foreach ($svc->listPublic() as $p) {
            if ((int)$p['id'] === $puzzleId) { $found = $p; break; }
        }
        assert_true($found !== null, '公开池应包含该题');
        assert_eq('机密汤底', $found['truth'], '公开池应展示汤底');

        // 复制公开汤面：衍生作品记录最初的原始作者
        $copied = $svc->copyPublic($copier, $puzzleId);
        assert_true(!empty($copied['success']), '复制应成功: ' . ($copied['error'] ?? ''));
        $copyRow = SoupPuzzleRepository::findById((int)$copied['id']);
        assert_eq($owner, (string)$copyRow['origin_author_id'], '衍生作品应记录原始作者 ID');

        // 删除是终态：公开汤面可删除，删除后从公开池消失（衍生作品另行保留）
        assert_true(!empty($svc->delete($owner, $puzzleId)['success']), '公开的汤面应可删除');
        foreach ($svc->listPublic() as $p) {
            assert_true((int)$p['id'] !== $puzzleId, '删除后不应再出现在公开池');
        }
        assert_true(SoupPuzzleRepository::findById((int)$copied['id']) !== null, '原汤删除后衍生作品仍应存在');
    } finally {
        $pdo->exec('DELETE FROM soup_puzzles WHERE owner_id = ' . $pdo->quote($owner));
        $pdo->exec('DELETE FROM soup_puzzles WHERE owner_id = ' . $pdo->quote($copier));
    }
}

// ==================== MySQL：战绩 ====================

function test_soup_record_repository_save_and_stats(): void
{
    SoupRecordRepository::ensureTable();
    $player = soup_test_uid('soup_test_');
    $pdo    = Database::connect();

    try {
        $before = SoupRecordRepository::statsByPlayer($player);
        assert_eq(0, $before['total'], '新玩家应无战绩');

        SoupRecordRepository::save($player, 'ROOM1', 0, 'host', true, 5, 1, 120);
        SoupRecordRepository::save($player, 'ROOM2', 0, 'guesser', false, 8, 0, 200);
        SoupRecordRepository::save('', 'ROOM3', 0, 'host', true, 1, 0, 10); // 空 playerId 应被忽略

        $stats = SoupRecordRepository::statsByPlayer($player);
        assert_eq(2, $stats['total'], '应记录 2 条');
        assert_eq(1, $stats['won'], '应有 1 次获胜');
        assert_eq(1, $stats['as_host'], '应有 1 次作为出题人');
        assert_eq(1, $stats['as_guesser'], '应有 1 次作为猜题人');

        $list = SoupRecordRepository::listByPlayer($player, 1, 20);
        assert_eq(2, $list['total'], '分页 total 应为 2');
        assert_eq(2, count($list['records']), '应返回 2 条记录');
    } finally {
        $pdo->exec('DELETE FROM soup_records WHERE player_id = ' . $pdo->quote($player));
    }
}