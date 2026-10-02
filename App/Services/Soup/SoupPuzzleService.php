<?php

namespace App\Services\Soup;

use App\Config\Config;
use App\Core\Sanitizer;
use App\Services\Repository\PlayerStatsRepository;
use App\Services\Repository\SoupPuzzleRepository;

/**
 * 汤面库业务逻辑：上传 / 管理 / 共享 / 选题
 *
 * 与 Repository 的区别：这里做字段校验、配额限制、可见性裁剪（对猜题人隐藏汤底）。
 */
class SoupPuzzleService
{
    /** 汤面/汤底最大长度 */
    private const MAX_SURFACE = 1000;
    private const MAX_TRUTH   = 2000;
    private const MAX_HINT    = 200;

    // ==================== 我的汤面 ====================

    /**
     * 我的汤面列表（含汤底，仅本人可见）
     */
    public function listMine(string $ownerId): array
    {
        return SoupPuzzleRepository::listByOwner($ownerId);
    }

    /**
     * 新建汤面
     *
     * @param string $originAuthorId 仅由复制流程内部传入，标记衍生作品的原始作者；不接受客户端输入
     * @return array{success: bool, error?: string, id?: int}
     */
    public function create(string $ownerId, array $data, string $originAuthorId = ''): array
    {
        if ($ownerId === '') return ['success' => false, 'error' => '身份验证失败'];

        $limit = (int)Config::get('Soup.PublicMaxMyPuzzles', 100);
        if ($limit > 0 && SoupPuzzleRepository::countByOwner($ownerId) >= $limit) {
            return ['success' => false, 'error' => "汤面数量已达上限（{$limit}）"];
        }

        $clean = $this->validate($data);
        if ($clean === null) return ['success' => false, 'error' => '汤面和汤底均不能为空'];

        $originAuthorId = mb_substr(trim($originAuthorId), 0, 64);
        if ($originAuthorId !== '') $clean['origin_author_id'] = $originAuthorId;

        $id = SoupPuzzleRepository::create($ownerId, $clean);
        if ($id === null) return ['success' => false, 'error' => '保存失败，请稍后再试'];

        return ['success' => true, 'id' => $id];
    }

    /**
     * 编辑汤面（仅本人）
     */
    public function update(string $ownerId, int $id, array $data): array
    {
        if ($ownerId === '' || $id <= 0) return ['success' => false, 'error' => '参数不完整'];

        $puzzle = $this->findOwned($ownerId, $id);
        if ($puzzle === null) return ['success' => false, 'error' => '汤面不存在或无权编辑'];
        if (!$this->isPrivate($puzzle)) return ['success' => false, 'error' => '已公开的汤面不可编辑'];

        $clean = $this->validate($data);
        if ($clean === null) return ['success' => false, 'error' => '汤面和汤底均不能为空'];

        if (!SoupPuzzleRepository::update($id, $ownerId, $clean)) {
            return ['success' => false, 'error' => '汤面不存在或无权编辑'];
        }
        return ['success' => true];
    }

    /**
     * 删除汤面（仅本人）
     *
     * 公开汤面同样可删除（删除即终态）：仅移除原汤，已复制出去的衍生汤不受影响。
     */
    public function delete(string $ownerId, int $id): array
    {
        if ($ownerId === '' || $id <= 0) return ['success' => false, 'error' => '参数不完整'];

        $puzzle = $this->findOwned($ownerId, $id);
        if ($puzzle === null) return ['success' => false, 'error' => '汤面不存在或无权删除'];

        if (!SoupPuzzleRepository::delete($id, $ownerId)) {
            return ['success' => false, 'error' => '汤面不存在或无权删除'];
        }
        return ['success' => true];
    }

    /**
     * 公开汤面（仅本人，单向不可逆）
     *
     * 公开后汤底对所有用户可见、退出可游玩池、不可编辑、不可转回私有；但可删除（删除即终态，仅移除原汤）。
     * @return array{success: bool, scope?: string, error?: string}
     */
    public function publish(string $ownerId, int $id): array
    {
        if ($ownerId === '' || $id <= 0) return ['success' => false, 'error' => '参数不完整'];

        $puzzle = $this->findOwned($ownerId, $id);
        if ($puzzle === null) return ['success' => false, 'error' => '汤面不存在或无权操作'];
        if (!$this->isPrivate($puzzle)) return ['success' => false, 'error' => '该汤面已公开，且不可撤回'];

        $result = SoupPuzzleRepository::setScope($id, $ownerId, 'public');
        if ($result === null) return ['success' => false, 'error' => '操作失败，请稍后再试'];
        return ['success' => true, 'scope' => $result];
    }

    // ==================== 公开汤池 ====================

    /**
     * 公开汤池（官方 + 玩家公开）：公开即作品，汤底对所有用户可见，并附带原作者信息
     */
    public function listPublic(): array
    {
        $rows = SoupPuzzleRepository::listPublic();

        // 需要解析昵称的用户：原创作者 + 衍生作品指向的原始作者（official 哨兵值除外）
        $authorIds = [];
        foreach ($rows as $row) {
            $ownerId = (string)($row['owner_id'] ?? '');
            if ((string)($row['source'] ?? '') === 'member' && $ownerId !== '') {
                $authorIds[] = $ownerId;
            }
            $originId = (string)($row['origin_author_id'] ?? '');
            if ($originId !== '' && $originId !== 'official') {
                $authorIds[] = $originId;
            }
        }
        $nicknames = PlayerStatsRepository::findNicknamesByIds($authorIds);

        return array_map(
            fn(array $row) => $this->toPublicView($row, $nicknames),
            $rows
        );
    }

    /**
     * 复制公开汤池 / 官方题库中的汤面到「我的汤面」（含汤底，复制后转为私有）
     * @return array{success: bool, id?: int, error?: string}
     */
    public function copyPublic(string $ownerId, int $id): array
    {
        if ($ownerId === '' || $id <= 0) return ['success' => false, 'error' => '参数不完整'];

        $src = SoupPuzzleRepository::findById($id);
        if (!$src || (string)$src['status'] !== 'active') {
            return ['success' => false, 'error' => '汤面不存在或已下架'];
        }

        $isOfficial    = (string)$src['source'] === 'official';
        $isPublicEntry = $isOfficial
            || ((string)$src['source'] === 'member' && (string)$src['scope'] === 'public');
        if (!$isPublicEntry) return ['success' => false, 'error' => '该汤面不在公开汤池中'];
        if (!$isOfficial && (string)$src['owner_id'] === $ownerId) {
            return ['success' => false, 'error' => '这是你自己的汤面，无需复制'];
        }

        // 衍生作品记录最初的原始作者：复制品再被复制也沿用同一个 origin，署名不因中间环节而漂移
        $srcOrigin = (string)($src['origin_author_id'] ?? '');
        if ($isOfficial) {
            $originAuthorId = 'official';
        } elseif ($srcOrigin !== '') {
            $originAuthorId = $srcOrigin;
        } else {
            $originAuthorId = (string)$src['owner_id'];
        }

        // 复用 create 的配额校验与字段清洗；新建汤面一律私有，公开需另行确认发布
        $result = $this->create($ownerId, [
            'title'      => (string)$src['title'],
            'surface'    => (string)$src['surface'],
            'truth'      => (string)$src['truth'],
            'key_points' => (array)$src['key_points'],
            'hints'      => (array)$src['hints'],
            'difficulty' => (int)$src['difficulty'],
            'tags'       => (string)$src['tags'],
        ], $originAuthorId);
        if (empty($result['success'])) {
            return ['success' => false, 'error' => $result['error'] ?? '复制失败'];
        }
        return ['success' => true, 'id' => $result['id']];
    }

    // ==================== 选题 ====================

    /**
     * 根据题库来源解析出开局用汤面（含汤底，仅服务端/出题人使用）
     *
     * @param string $source      mine / public / official / random
     * @param int    $puzzleId    指定题目 id（random 时可忽略）
     * @param int[]  $excludeIds  随机时排除的已用题目 id
     * @return array{success: bool, puzzle?: array, error?: string}
     */
    public function resolveForRoom(string $ownerId, string $source, int $puzzleId, array $excludeIds = []): array
    {
        $source = in_array($source, ['mine', 'public', 'official', 'random'], true) ? $source : 'random';

        if ($source === 'random') {
            $puzzle = SoupPuzzleRepository::randomPublic($excludeIds);
            if (!$puzzle) return ['success' => false, 'error' => '公开汤池暂无可用题目'];
            return ['success' => true, 'puzzle' => $puzzle];
        }

        if ($puzzleId <= 0) return ['success' => false, 'error' => '请选择一道汤面'];

        $puzzle = SoupPuzzleRepository::findById($puzzleId);
        if (!$puzzle || (string)$puzzle['status'] !== 'active') {
            return ['success' => false, 'error' => '汤面不存在或已下架'];
        }

        $isOfficial = (string)$puzzle['source'] === 'official';
        $isPublic   = $isOfficial || (string)$puzzle['scope'] === 'public';

        switch ($source) {
            case 'mine':
                if ((string)$puzzle['owner_id'] !== $ownerId || (string)$puzzle['source'] !== 'member') {
                    return ['success' => false, 'error' => '只能选择自己的汤面'];
                }
                if (!$this->isPrivate($puzzle)) {
                    return ['success' => false, 'error' => '已公开的汤面不可用于创建房间'];
                }
                break;
            case 'official':
                if (!$isOfficial) return ['success' => false, 'error' => '该题不是官方题目'];
                break;
            case 'public':
            default:
                if (!$isPublic) return ['success' => false, 'error' => '该汤面未公开共享'];
                break;
        }

        return ['success' => true, 'puzzle' => $puzzle];
    }

    // ==================== 内部 ====================

    /**
     * 校验并整理输入字段
     */
    private function validate(array $data): ?array
    {
        $title   = Sanitizer::text((string)($data['title'] ?? ''), 100);
        $surface = Sanitizer::text((string)($data['surface'] ?? ''), self::MAX_SURFACE);
        $truth   = Sanitizer::text((string)($data['truth'] ?? ''), self::MAX_TRUTH);
        if ($surface === '' || $truth === '') return null;
        if ($title === '') $title = mb_substr($surface, 0, 20);

        // key_points / hints：数组裁剪
        $keyPoints = [];
        foreach ((array)($data['key_points'] ?? []) as $kp) {
            $kp = Sanitizer::text((string)$kp, 100);
            if ($kp !== '') $keyPoints[] = $kp;
        }
        $hints = [];
        foreach ((array)($data['hints'] ?? []) as $h) {
            $h = Sanitizer::text((string)$h, self::MAX_HINT);
            if ($h !== '') $hints[] = $h;
        }

        $tags = Sanitizer::text((string)($data['tags'] ?? ''), 255);
        $difficulty = max(1, min(3, (int)($data['difficulty'] ?? 1)));

        return [
            'title'      => $title,
            'surface'    => $surface,
            'truth'      => $truth,
            'key_points' => $keyPoints,
            'hints'      => $hints,
            'difficulty' => $difficulty,
            'tags'       => $tags,
            'scope'      => $scope,
        ];
    }

    /**
     * 取本人名下的 member 汤面，不存在 / 非本人返回 null
     */
    private function findOwned(string $ownerId, int $id): ?array
    {
        $puzzle = SoupPuzzleRepository::findById($id);
        if (!$puzzle || (string)$puzzle['owner_id'] !== $ownerId || (string)$puzzle['source'] !== 'member') {
            return null;
        }
        return $puzzle;
    }

    /** 是否为私有（未公开）汤面 */
    private function isPrivate(array $puzzle): bool
    {
        return (string)($puzzle['scope'] ?? 'private') !== 'public';
    }

    /**
     * 公开视图：公开即作品，汤底一并展示，并附带原作者昵称
     *
     * @param array<string,string> $nicknames owner_id => nickname
     */
    private function toPublicView(array $row, array $nicknames = []): array
    {
        $isOfficial = (string)$row['source'] === 'official';
        $ownerId  = (string)($row['owner_id'] ?? '');
        $originId = (string)($row['origin_author_id'] ?? '');

        // 衍生作品署名指向最初的原始作者；原创作品署名指向本人；官方题署名「官方」
        $isDerivative = $originId !== '';
        if ($originId === 'official') {
            $author = '官方';
        } elseif ($originId !== '') {
            $author = $nicknames[$originId] ?? '已注销用户';
        } elseif ($isOfficial || $ownerId === '') {
            $author = '官方';
        } else {
            $author = $nicknames[$ownerId] ?? '已注销用户';
        }

        return [
            'id'            => (int)$row['id'],
            'source'        => (string)$row['source'],
            'scope'         => (string)$row['scope'],
            'title'         => (string)$row['title'],
            'surface'       => (string)$row['surface'],
            'truth'         => (string)($row['truth'] ?? ''),
            'author'        => $author,
            'is_derivative' => $isDerivative,
            'difficulty'    => (int)$row['difficulty'],
            'tags'          => (string)$row['tags'],
            'used_count'    => (int)$row['used_count'],
        ];
    }
}