<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PageContent extends Model
{
    protected $fillable = [
        'page_key',
        'title',
        'title_mm',
        'content',
        'content_mm',
    ];
}
