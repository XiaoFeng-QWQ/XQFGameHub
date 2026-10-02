<?php

require_once __DIR__ . '/vendor/autoload.php';

use App\Core\Application;

date_default_timezone_set('Asia/Shanghai');
$app = new Application();
$app->run();
